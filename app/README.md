# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **src/app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **example** directory and create a blank **src/app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.


## Autenticação Biométrica e Limitações de Plataforma

O FuelLog suporta login rápido por biometria nativa (Face ID, Impressão Digital) em Android e iOS protegendo a sessão com criptografia de envelope (AES-256-GCM nativo do `expo-crypto`) e chave mestra armazenada sob `SecureStore.requireAuthentication`.

### Requisitos e Limitações de Execução

1. **iOS (Face ID / Touch ID):**
   - O uso de `SecureStore` com `requireAuthentication: true` e `NSFaceIDUsageDescription` requer compilação nativa (`npx expo run:ios` ou development build EAS).
   - No **Expo Go (iOS)**, o Face ID e o `requireAuthentication` possuem restrições nativas da sandbox do sandbox app do Expo. O FuelLog detecta o ambiente Expo Go e informa ao usuário a necessidade de build própria para ativar o recurso.

2. **Android (Biometria Forte):**
   - Suporte verificado via `SecureStore.canUseBiometricAuthentication()` e `expo-local-authentication`. Métodos fracos ou não cadastrados falham de forma segura (fail-closed).
   - Testes em emuladores Android ou simuladores iOS não comprovam a proteção nativa contra extração de chaves sem hardware real.

3. **Web:**
   - Mantém o fluxo padrão de e-mail e senha com armazenamento de sessão isolado (`sessionStorage`), sem simulação de biometria.

## Distribuição pessoal com OTA

O desenvolvimento mantém `app.json`, plugins e `.env.local`, com OTA desabilitado. OTA é opt-in e exige configuração completa; valores parciais ou inválidos interrompem a configuração antes do build.

Guarde os valores reais somente em `app/.env.exclusive.local` (ignorado pelo Git) ou no ambiente local de build. Nunca os copie para código, exemplos, testes ou documentação. O arquivo pessoal deve conter suas próprias quatro variáveis, sem depender do ambiente herdado:

```dotenv
EXPO_PUBLIC_API_URL=https://api.example.com/api/v1
FUELLOG_OTA_URL=https://updates.example.com/manifest
FUELLOG_OTA_CHANNEL=personal-meu-aparelho
FUELLOG_OTA_RUNTIME_POLICY=fingerprint
```

Para EAS Update, use `https://u.expo.dev/<projectId>` e acrescente `FUELLOG_EAS_PROJECT_ID=<projectId>` no mesmo arquivo. Um endpoint próprio não usa essa variável. O canal `personal-<identificador>` isola a distribuição; ele não autentica nem torna o conteúdo privado.

Na pasta `app`, use `node scripts/exclusive.mjs config` para validar sem imprimir endereços. O script lê o arquivo pessoal com precedência sobre o ambiente e desativa o dotenv automático do Expo, evitando herdar a API LAN de `.env.local`. Os modos `prebuild` e `export` usam o mesmo ambiente, gerando Android sem `--clean` e exportando para `dist/personal`, respectivamente. Pré-build não substitui o build Gradle assinado.

Para publicar no projeto/canal EAS já criados, mantenha a conta Expo autenticada e execute:

```bash
node scripts/personal-update.mjs /caminho/FuelLog-Pessoal-OTA.apk "Descrição da atualização"
```

O comando exige JDK (`JAVA_HOME`), Android SDK (`ANDROID_HOME`) e EAS CLI instalado. Se o EAS CLI estiver fora das dependências locais, defina `FUELLOG_EAS_CLI` com o caminho do seu arquivo JavaScript `eas-cli/bin/run`, inclusive no arquivo pessoal ignorado. Não use o arquivo `.cmd` nessa variável. O comando verifica canal, servidor e fingerprint do APK, recusa outro endpoint de API no bundle e exporta novamente com o mesmo ambiente pessoal. Publica somente Android no canal pessoal, usando `--skip-bundler --input-dir` e o ambiente EAS `development`, obrigatório no SDK 58. Variáveis conflitantes nesse ambiente EAS (projeto ou conta) interrompem a publicação; a API pessoal não deve ser cadastrada no EAS.

Mantenha `android/` e `ios/` gerados e ignorados pelo Git. No fluxo CNG, o `expo-updates` exclui esses diretórios do fingerprint tanto no build quanto na publicação, preservando a correspondência entre a árvore fonte e a cópia local de compilação. Compile com o mesmo arquivo pessoal, sem overrides de fingerprint/workflow, e confira `assets/fingerprint` do APK final. O publicador compara esse valor com o fingerprint atual e exige novo APK quando houver mudança nativa; nunca fixe um hash manualmente para contornar essa verificação. Não instale ou limpe dados automaticamente.

O cliente nativo verifica atualizações ao abrir (`ON_LOAD`), mantém o bundle embarcado para uso offline e aplica o download em uma próxima abertura, sem recarregar uma tela em uso. O runtime usa `fingerprint`: mudanças nativas exigem novo APK compatível. Esse comportamento precisa ser verificado em build release e aparelho real; Expo Go e testes Node não o comprovam.
