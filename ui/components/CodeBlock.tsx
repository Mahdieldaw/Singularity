import React, { useCallback, useMemo, useState } from "react";

type Props = {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
};

function languageToExt(lang: string): string {
  switch (String(lang).toLowerCase()) {
    case "javascript":
    case "js":
      return "js";
    case "typescript":
    case "ts":
      return "ts";
    case "tsx":
      return "tsx";
    case "jsx":
      return "jsx";
    case "json":
      return "json";
    case "python":
    case "py":
      return "py";
    case "go":
    case "golang":
      return "go";
    case "java":
      return "java";
    case "ruby":
    case "rb":
      return "rb";
    case "bash":
    case "sh":
      return "sh";
    case "markdown":
    case "md":
      return "md";
    case "yaml":
    case "yml":
      return "yml";
    case "html":
      return "html";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "c":
      return "c";
    case "cpp":
    case "c++":
      return "cpp";
    case "csharp":
    case "cs":
      return "cs";
    case "php":
      return "php";
    case "rust":
    case "rs":
      return "rs";
    case "kotlin":
    case "kt":
      return "kt";
    case "swift":
      return "swift";
    default:
      return "txt";
  }
}

export default function CodeBlock({ inline, className, children }: Props) {
  const isInline = inline === true;
  const codeText = useMemo(() => String(children || ""), [children]);
  const match = useMemo(
    () => /language-([a-zA-Z0-9+#]+)/.exec(String(className || "")),
    [className],
  );
  const language = match ? match[1] : "";
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(codeText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {}
    },
    [codeText],
  );

  const filename = useMemo(
    () => `snippet.${languageToExt(language)}`,
    [language],
  );
  const handleDownload = useCallback(() => {
    try {
      const blob = new Blob([codeText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        try {
          document.body.removeChild(a);
        } catch {}
      }, 0);
    } catch {}
  }, [codeText, filename]);

  if (isInline) {
    return <code className={className}>{children}</code>;
  }

  return (
    <div
      style={{
        position: "relative",
        background: "#0b1220",
        border: "1px solid #334155",
        borderRadius: 8,
        margin: "8px 0",
      }}
    >
      <div style={{ margin: 0, overflowX: "auto", padding: 12 }}>
        <code className={className} style={{ fontSize: 14, display: 'block' }}>{codeText}</code>
      </div>
      <div
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          display: "flex",
          gap: 6,
        }}
      >
        <button
          onClick={handleCopy}
          style={{
            background: "#334155",
            border: "1px solid #475569",
            borderRadius: 6,
            padding: "4px 8px",
            color: "#94a3b8",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {copied ? "✓ Copied" : "📋 Copy"}
        </button>
        <button
          onClick={handleDownload}
          style={{
            background: "#334155",
            border: "1px solid #475569",
            borderRadius: 6,
            padding: "4px 8px",
            color: "#94a3b8",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          ⬇️ Download
        </button>
      </div>
      {language && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 10,
            fontSize: 11,
            color: "#94a3b8",
          }}
        >
          {language}
        </div>
      )}
    </div>
  );
}
