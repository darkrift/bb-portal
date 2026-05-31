import { AnsiUp } from "ansi_up";
import React, { useEffect, useRef } from "react";
import { experimental_VGrid as VGrid, type VGridHandle } from "virtua";
import PortalAlert from "../PortalAlert";
import styles from "./index.module.css";

const ansi = new AnsiUp();

interface Props {
  log: string;
  activeLineIndex?: number;
  matchedLineIndexes?: number[];
}

// Takes a log in ansi style, formats it to HTML, and displays it in a scrollable window with virtualization
const AnsiScrollingWindow: React.FC<Props> = ({
  log,
  activeLineIndex,
  matchedLineIndexes,
}) => {
  const lines = React.useMemo(() => {
    if (!log) return [];
    return ansi.ansi_to_html(log).split("\n");
  }, [log]);

  const vListRef = useRef<VGridHandle>(null);

  useEffect(() => {
    if (!vListRef.current) {
      return;
    }
    if (typeof activeLineIndex === "number") {
      vListRef.current.scrollToIndex(activeLineIndex);
      return;
    }
    vListRef.current.scrollToIndex(lines.length - 1);
  }, [activeLineIndex, lines]);

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
  const LINE_HEIGHT = 16.66; // 14px base font size * 0.85 font-size * 1.4 line-height
  const PADDING_HEIGHT = 14; // (Vertical padding + border) * 2
  const MAX_VISIBLE_LINES = 27.3; // Make the top line only partially visible to convey that the view screen is scrollable
  const renderLine = (html: string, rowIndex: number) => {
    const isMatch = matchedLineIndexes?.includes(rowIndex) ?? false;
    const isActive = activeLineIndex === rowIndex;
    const className = [
      styles.logLine,
      isMatch ? styles.matchLine : "",
      isActive ? styles.activeMatchLine : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        // biome-ignore lint/suspicious/noArrayIndexKey: We have nothing better to use
        key={rowIndex}
        className={className}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Should be reworked
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  };
  if (lines.length < MAX_VISIBLE_LINES) {
    return (
      <pre className={styles.scrollWindow}>
        {lines.map((v, i) => renderLine(v, i))}
      </pre>
    );
  }
  return (
    <pre>
      <VGrid
        ref={vListRef}
        style={{
          height: MAX_VISIBLE_LINES * LINE_HEIGHT + PADDING_HEIGHT,
        }}
        className={styles.scrollWindow}
        row={lines.length}
        col={1}
        cellHeight={LINE_HEIGHT}
      >
        {({ rowIndex }) => renderLine(lines[rowIndex], rowIndex)}
      </VGrid>
    </pre>
  );
};

export { AnsiScrollingWindow };
