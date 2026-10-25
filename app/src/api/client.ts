import {
  clearStoredTokens,
  getAccessToken,
  getRefreshToken,
  getSessionEpoch,
  saveTokenPairAtomically,
} from './tokenStorage';
import { ApiError, ProblemDetails, RefreshRequest, TokenResponse } from './types';

const DEFAULT_API_URL = 'http://localhost:8080/api/v1';
const REQUEST_TIMEOUT_MS = 15000;

export function getApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!configured) {
    return DEFAULT_API_URL;
  }
  return configured.replace(/\/+$/, '');
}

type UnauthorizedListener = () => void;
let unauthorizedListener: UnauthorizedListener | null = null;

export function setOnUnauthorizedListener(listener: UnauthorizedListener | null): void {
  unauthorizedListener = listener;
}

let inFlightRefreshPromise: Promise<TokenResponse> | null = null;

async function parseProblemOrJson<T>(response: Response): Promise<T | undefined> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function buildHumanErrorMessage(status: number, problem?: ProblemDetails): string {
  if (problem?.detail) {
    return problem.detail;
  }
  if (problem?.title) {
    return problem.title;
  }
  if (status === 401) {
    return 'Sua sessão expirou ou as credenciais são inválidas.';
  }
  if (status === 403) {
    return 'Você não tem permissão para acessar este recurso.';
  }
  if (status === 404) {
    return 'O recurso solicitado não foi encontrado.';
  }
  if (status === 409) {
    return 'Conflito ao salvar os dados. Verifique os valores informados.';
  }
  if (status === 422 || status === 400) {
    return 'Verifique os campos destacados e tente novamente.';
  }
  if (status >= 500) {
    return 'O servidor está temporariamente indisponível. Tente novamente em instantes.';
  }
  return `Erro inesperado na comunicação com o servidor (HTTP ${status}).`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const method = (init.method ?? 'GET').toUpperCase();
    const isMutation = method !== 'GET' && method !== 'HEAD';
    throw new ApiError({
      message: isAbort
        ? 'O servidor demorou para responder. Verifique sua conexão antes de tentar novamente.'
        : 'Não foi possível conectar ao servidor FuelLog. Verifique sua conexão ou se a API está ativa.',
      kind: isAbort ? 'timeout' : 'network',
      isUncertainWrite: isMutation,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executa refresh single-flight conforme o contrato OpenAPI:
 * POST /auth/refresh com body { refresh_token } e resposta TokenResponse (access_token, refresh_token, ...).
 * - Se falhar com 400/401/403 (refresh inválido, expirado ou reutilizado), limpa os tokens e avisa listener.
 * - Se falhar por erro de rede/timeout/5xx, NÃO apaga o refresh_token válido salvo.
 * - Se a época da sessão mudar (logout/troca de conta durante o voo), descarta o resultado e lança 401.
 */
export async function performSingleFlightRefresh(): Promise<TokenResponse> {
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  const epochAtStart = getSessionEpoch();

  inFlightRefreshPromise = (async () => {
    const storedRefresh = await getRefreshToken();
    if (!storedRefresh || getSessionEpoch() !== epochAtStart) {
      if (!storedRefresh && getSessionEpoch() === epochAtStart) {
        try {
          await clearStoredTokens();
        } catch {
          // Ignora erro de remoção quando já estava vazio
        }
      }
      throw new ApiError({
        message: 'Sessão encerrada. Entre novamente.',
        kind: 'unauthorized',
        status: 401,
      });
    }

    const payload: RefreshRequest = { refresh_token: storedRefresh };
    const url = `${getApiBaseUrl()}/auth/refresh`;
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, application/problem+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (getSessionEpoch() !== epochAtStart) {
      throw new ApiError({
        message: 'Sessão encerrada durante a renovação.',
        kind: 'unauthorized',
        status: 401,
      });
    }

    if (!response.ok) {
      const problem = await parseProblemOrJson<ProblemDetails>(response);
      if (getSessionEpoch() !== epochAtStart) {
        throw new ApiError({
          message: 'Sessão encerrada durante a renovação.',
          kind: 'unauthorized',
          status: 401,
        });
      }

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        try {
          await clearStoredTokens();
        } finally {
          unauthorizedListener?.();
        }
        throw new ApiError({
          message: 'Sua sessão expirou. Faça login novamente para continuar.',
          kind: 'unauthorized',
          status: response.status,
          problem,
        });
      }

      throw new ApiError({
        message: buildHumanErrorMessage(response.status, problem),
        kind: 'http',
        status: response.status,
        problem,
      });
    }

    const data = await parseProblemOrJson<TokenResponse>(response);
    if (!data?.access_token || !data?.refresh_token) {
      throw new ApiError({
        message: 'Resposta de autenticação inválida recebida do servidor.',
        kind: 'http',
        status: 500,
      });
    }

    if (getSessionEpoch() !== epochAtStart) {
      throw new ApiError({
        message: 'Sessão encerrada durante a renovação.',
        kind: 'unauthorized',
        status: 401,
      });
    }

    await saveTokenPairAtomically(data.access_token, data.refresh_token, epochAtStart);
    return data;
  })().finally(() => {
    inFlightRefreshPromise = null;
  });

  return inFlightRefreshPromise;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  authenticated?: boolean;
  retryOn401?: boolean;
}

export async function apiRequest<T = void>(options: ApiRequestOptions): Promise<T> {
  const {
    method = 'GET',
    path,
    query,
    body,
    authenticated = true,
    retryOn401 = true,
  } = options;

  const epochAtRequestStart = getSessionEpoch();

  const ensureSameSessionEpoch = () => {
    if (authenticated && getSessionEpoch() !== epochAtRequestStart) {
      throw new ApiError({
        message: 'Sessão encerrada.',
        kind: 'unauthorized',
        status: 401,
      });
    }
  };

  const searchParams = new URLSearchParams();
  if (query) {
    for (const [key, val] of Object.entries(query)) {
      if (val !== undefined && val !== null && val !== '') {
        searchParams.append(key, String(val));
      }
    }
  }

  const queryString = searchParams.toString();
  const url = `${getApiBaseUrl()}${path}${queryString ? `?${queryString}` : ''}`;

  const executeAttempt = async (tokenToUse: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: 'application/json, application/problem+json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (authenticated && tokenToUse) {
      headers.Authorization = `Bearer ${tokenToUse}`;
    }

    return fetchWithTimeout(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let token = authenticated ? getAccessToken() : null;
  if (authenticated && !token) {
    const refreshed = await performSingleFlightRefresh();
    ensureSameSessionEpoch();
    token = refreshed.access_token;
  }

  let response = await executeAttempt(token);
  ensureSameSessionEpoch();

  if (authenticated && response.status === 401 && retryOn401) {
    const refreshed = await performSingleFlightRefresh();
    ensureSameSessionEpoch();
    response = await executeAttempt(refreshed.access_token);
    ensureSameSessionEpoch();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    const problem = await parseProblemOrJson<ProblemDetails>(response);
    ensureSameSessionEpoch();

    if (authenticated && response.status === 401) {
      try {
        await clearStoredTokens();
      } finally {
        unauthorizedListener?.();
      }
    }
    const isMutation = method !== 'GET';
    throw new ApiError({
      message: buildHumanErrorMessage(response.status, problem),
      kind: response.status === 401 ? 'unauthorized' : 'http',
      status: response.status,
      problem,
      isUncertainWrite: isMutation && response.status >= 500,
    });
  }

  const parsed = await parseProblemOrJson<T>(response);
  ensureSameSessionEpoch();
  return parsed as T;
}
