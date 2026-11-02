package com.fuellog.vikash.exceptions;

public class ViKashRemoteException extends RuntimeException {
    public enum Reason { INVALID_CLIENT, INVALID_GRANT, INVALID_SCOPE, INVALID_RESPONSE, UNAVAILABLE, NETWORK_TIMEOUT, TLS, DNS, NETWORK_IO }
    private final int status;
    private final String code;
    private final int remoteStatus;
    private final Reason reason;
    public ViKashRemoteException(int status, String code) {
        this(status,code,status,"INVALID_RESPONSE".equals(code) ? Reason.INVALID_RESPONSE : Reason.UNAVAILABLE);
    }
    public ViKashRemoteException(int status, String code, int remoteStatus, Reason reason) {
        super("ViKash request failed"); this.status=status; this.code=code; this.remoteStatus=remoteStatus; this.reason=reason;
    }
    public int status() { return status; }
    public String code() { return code; }
    public int remoteStatus() { return remoteStatus; }
    public Reason reason() { return reason; }
    public boolean retryable() { return status == 0 || status == 429 || status >= 500; }
}
