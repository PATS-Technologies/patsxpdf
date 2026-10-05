package com.patstechnologies.patsxpdf;

import java.time.Instant;
import java.util.UUID;

public record OcrJob(
    UUID id,
    Status status,
    String mode,
    String languages,
    Integer page,
    int totalPages,
    int processedPages,
    String error,
    Instant createdAt,
    Instant completedAt
) {
    public enum Status {
        QUEUED,
        PROCESSING,
        COMPLETED,
        ERROR
    }

    public OcrJob withProgress(Status nextStatus, int total, int processed, String nextError, Instant completed) {
        return new OcrJob(id, nextStatus, mode, languages, page, total, processed, nextError, createdAt, completed);
    }
}
