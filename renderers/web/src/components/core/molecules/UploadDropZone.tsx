'use client';

import React, { useCallback, useRef, useState } from "react";
import type { EventEmit, EventPayload, A11yProps } from "@almadar/core";
import { cn } from '../../../core';
import { Icon } from '../../../core';
import type { IconInput } from '../../../core';
import { Typography } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
function useSafeEventBus() {
  try {
    return useEventBus();
  } catch {
    return { emit: () => {}, on: () => () => {}, once: () => {} };
  }
}

export interface UploadDropZoneProps extends A11yProps {
  /** Accepted MIME types (e.g., "image/*", "application/pdf") */
  accept?: string;
  /** Max file size in bytes */
  maxSize?: number;
  /** Max number of files */
  maxFiles?: number;
  /** Label text */
  label?: string;
  /** Description text below label */
  description?: string;
  /** Icon name or component */
  icon?: IconInput;
  /** Disabled state */
  disabled?: boolean;
  /** How the file is read into `content`: a base64 data URL (default) or its UTF-8 text */
  readAs?: "dataUrl" | "text";
  /** Declarative event name for file selection */
  action?: EventEmit<{ files: { name: string; size: number; type: string; content: string }[] }>;
  /** Payload to include with the action event
   *  @payloadFor action
   */
  actionPayload?: EventPayload;
  /** Direct onFiles callback */
  onFiles?: (files: File[]) => void;
  /** Additional CSS classes */
  className?: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

export const UploadDropZone: React.FC<UploadDropZoneProps> = ({
  accept,
  maxSize,
  maxFiles = 1,
  label,
  description,
  icon,
  disabled = false,
  readAs = "dataUrl",
  action,
  actionPayload,
  onFiles,
  className,
  ...rest
}) => {
  const { t } = useTranslate();
  const resolvedLabel = label ?? t("upload.dropOrBrowse");
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const eventBus = useSafeEventBus();

  const defaultDescription = [
    accept ? t("upload.accepted", { accept }) : null,
    maxSize ? t("upload.maxSize", { size: formatFileSize(maxSize) }) : null,
    maxFiles > 1 ? t("upload.maxFiles", { count: maxFiles }) : null,
  ]
    .filter(Boolean)
    .join(". ");

  const validateFiles = useCallback(
    (files: File[]): { valid: File[]; error: string | null } => {
      if (files.length > maxFiles) {
        return { valid: [], error: t("upload.error.maxFiles", { count: maxFiles }) };
      }

      if (accept) {
        const acceptedTypes = accept.split(",").map((s) => s.trim());
        const invalid = files.filter((file) => {
          return !acceptedTypes.some((type) => {
            if (type.endsWith("/*")) {
              return file.type.startsWith(type.replace("/*", "/"));
            }
            return file.type === type || file.name.endsWith(type);
          });
        });
        if (invalid.length > 0) {
          return { valid: [], error: t("upload.error.invalidType", { name: invalid[0].name }) };
        }
      }

      if (maxSize) {
        const tooLarge = files.filter((file) => file.size > maxSize);
        if (tooLarge.length > 0) {
          return {
            valid: [],
            error: t("upload.error.tooLarge", { name: tooLarge[0].name, size: formatFileSize(maxSize) }),
          };
        }
      }

      return { valid: files, error: null };
    },
    [accept, maxSize, maxFiles, t],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const { valid, error: validationError } = validateFiles(files);
      setError(validationError);

      if (valid.length > 0) {
        onFiles?.(valid);
        if (action) {
          // The payload must carry the BYTES (base64 data URL, or text when readAs="text"), not just
          // metadata — a downstream STORAGE_UPLOAD handler
          // has nothing to store otherwise. Size is already
          // capped by validateFiles/maxSize before any read happens.
          void Promise.all(
            valid.map(
              (f) =>
                new Promise<{ name: string; size: number; type: string; content: string }>(
                  (resolvePayload, rejectPayload) => {
                    const reader = new FileReader();
                    reader.onload = () =>
                      resolvePayload({
                        name: f.name,
                        size: f.size,
                        type: f.type,
                        content: String(reader.result ?? ''),
                      });
                    reader.onerror = () => rejectPayload(reader.error);
                    if (readAs === "text") reader.readAsText(f);
                    else reader.readAsDataURL(f);
                  },
                ),
            ),
          )
            .then((payloadFiles) => {
              eventBus.emit(`UI:${action}`, {
                ...actionPayload,
                files: payloadFiles,
              });
            })
            .catch(() => {
              setError(t('upload.error.readFailed'));
            });
        }
      }
    },
    [validateFiles, onFiles, action, actionPayload, readAs, eventBus, t],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (disabled) return;

    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) handleFiles(files);
    // Reset input so the same file can be re-selected
    e.target.value = "";
  };

  return (
    <div
      {...domPassthrough(rest)}
      className={cn(
        "relative flex flex-col items-center justify-center",
        "p-8 rounded-interactive",
        "border-heavy border-dashed",
        "transition-colors duration-fast",
        "cursor-pointer",
        isDragOver
          ? "border-primary bg-primary bg-opacity-5"
          : "border-border bg-surface",
        error && "border-error",
        disabled && "opacity-50 cursor-not-allowed",
        "hover:border-primary hover:bg-muted",
        className,
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={rest['aria-label'] ?? resolvedLabel}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={maxFiles > 1}
        onChange={handleInputChange}
        className="hidden"
        disabled={disabled}
        aria-hidden="true"
      />

      {error ? (
        <Icon name="file-warning" size="lg" className="text-error mb-2" />
      ) : icon ? (
        typeof icon === 'string'
          ? <Icon name={icon} size="lg" className="text-muted-foreground mb-2" />
          : <Icon icon={icon} size="lg" className="text-muted-foreground mb-2" />
      ) : (
        <Icon name="upload" size="lg" className="text-muted-foreground mb-2" />
      )}

      <Typography variant="body1" className="text-center font-medium mb-1">
        {isDragOver ? t("upload.dropFilesHere") : resolvedLabel}
      </Typography>

      {error ? (
        <Typography variant="caption" color="error" className="text-center">
          {error}
        </Typography>
      ) : (
        <Typography variant="caption" color="muted" className="text-center">
          {description ?? defaultDescription}
        </Typography>
      )}
    </div>
  );
};

UploadDropZone.displayName = "UploadDropZone";
