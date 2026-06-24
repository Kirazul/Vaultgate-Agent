"use client";

import { FileIcon } from "@react-symbols/icons/utils";

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path || "file";
}

export function FileSymbolIcon({ path, className, size = 16 }: { path: string; className?: string; size?: number }) {
  return (
    <div className={className}>
      <FileIcon
        aria-hidden="true"
        autoAssign
        fileName={fileName(path)}
        focusable="false"
        height={size}
        style={{ minWidth: size, minHeight: size, display: "inline-block", transform: "translateY(-1px)" }}
        width={size}
      />
    </div>
  );
}
