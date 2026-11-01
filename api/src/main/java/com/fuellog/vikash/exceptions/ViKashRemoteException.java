package com.fuellog.vikash.exceptions;

public class ViKashRemoteException extends RuntimeException {
    private final int status;
    private final String code;
    public ViKashRemoteException(int status, String code) { super("ViKash request failed"); this.status=status; this.code=code; }
    public int status() { return status; }
    public String code() { return code; }
    public boolean retryable() { return status == 0 || status == 429 || status >= 500; }
}
