import { AnsiUp } from "ansi_up";
import { Spin } from "antd";
import React from "react";
import PortalAlert from "@/components/PortalAlert";
import styles from "./index.module.css";

const ansi = new AnsiUp();

interface Props {
  log?: string | null;
  loading?: boolean;
  error?: Error | null;
  searchTerm?: string;
  activeMatchIndex?: number;
}

const escapeRegex = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const highlightSearchTerm = (
  html: string,
  searchTerm: string,
  activeMatchIndex?: number,
): string => {
  const trimmedSearchTerm = searchTerm.trim();
  if (!trimmedSearchTerm) {
    return html;
  }

  const parser = new DOMParser();
  const parsedDocument = parser.parseFromString(
    `<div id="root">${html}</div>`,
    "text/html",
  );
  const root = parsedDocument.getElementById("root");
  if (!root) {
    return html;
  }

  const regex = new RegExp(escapeRegex(trimmedSearchTerm), "gi");
  let matchCount = 0;

  const processNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent || "";
      regex.lastIndex = 0;
      if (!regex.test(value)) {
        return;
      }

      const fragment = parsedDocument.createDocumentFragment();
      let lastIndex = 0;
      regex.lastIndex = 0;

      for (const match of value.matchAll(regex)) {
        const matchIndex = match.index || 0;
        if (matchIndex > lastIndex) {
          fragment.append(value.slice(lastIndex, matchIndex));
        }

        const mark = parsedDocument.createElement("mark");
        mark.className =
          matchCount === activeMatchIndex
            ? `${styles.logMatch} ${styles.logActiveMatch}`
            : styles.logMatch;
        mark.textContent = match[0];
        fragment.append(mark);

        lastIndex = matchIndex + match[0].length;
        matchCount += 1;
      }

      if (lastIndex < value.length) {
        fragment.append(value.slice(lastIndex));
      }

      node.parentNode?.replaceChild(fragment, node);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const childNodes = Array.from(node.childNodes);
    for (const child of childNodes) {
      processNode(child);
    }
  };

  processNode(root);
  return root.innerHTML;
};

const LogViewer: React.FC<Props> = ({
  log,
  loading,
  error,
  searchTerm,
  activeMatchIndex,
}) => {
  const html = React.useMemo(() => {
    if (!log) return "";
    const rendered = ansi.ansi_to_html(log);
    return searchTerm
      ? highlightSearchTerm(rendered, searchTerm, activeMatchIndex)
      : rendered;
  }, [log, searchTerm, activeMatchIndex]);

  const logContainerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!searchTerm || !logContainerRef.current) {
      return;
    }
    const targetMatch = logContainerRef.current.querySelector(
      `mark.${styles.logActiveMatch}`,
    ) as HTMLElement | null;
    const firstMatch = targetMatch ?? (logContainerRef.current.querySelector(
      `mark.${styles.logMatch}`,
    ) as HTMLElement | null);
    firstMatch?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [html, searchTerm, activeMatchIndex]);

  if (loading === true)
    return (
      <Spin>
        <pre />
      </Spin>
    );

  if (error) {
    return (
      <PortalAlert
        type="error"
        message={error.message}
        showIcon
        className={styles.alert}
      />
    );
  }

  if (!log) {
    return (
      <PortalAlert
        message="There is no log information to display"
        type="warning"
        showIcon
        className={styles.alert}
      />
    );
  }

  return (
    <div
      ref={logContainerRef}
      className={styles.logContainer}
      // TODO: Remove the danger
      // biome-ignore lint/security/noDangerouslySetInnerHTML: Should be reworked
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default LogViewer;
