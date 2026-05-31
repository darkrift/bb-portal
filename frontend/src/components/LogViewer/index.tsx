import { DownloadOutlined, FileSearchOutlined } from "@ant-design/icons";
import { Button, Input, Space, Spin, Typography } from "antd";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import PortalAlert from "@/components/PortalAlert";
import { useBbPortalMessage } from "@/context/MessageContext";
import PortalCard from "../PortalCard";
import { AnsiScrollingWindow } from "./ansiScrollWindow";
import styles from "./index.module.css";

interface Props {
  log?: string | undefined;
  loading?: boolean;
  error?: Error | null;
  title: string;
  logDownloadUrl: string | undefined;
  fileName?: string;
}

const LogViewerCard: React.FC<Props> = ({
  log,
  loading,
  error,
  title,
  logDownloadUrl,
  fileName,
}) => {
  const { copyToClipboard } = useBbPortalMessage();
  const [searchDraft, setSearchDraft] = useState("");
  const [activeSearchTerm, setActiveSearchTerm] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  const logLines = useMemo(() => log?.split(/\r?\n/) ?? [], [log]);
  const normalizedSearchTerm = activeSearchTerm.trim().toLowerCase();
  const matchingLineIndexes = useMemo(() => {
    if (!normalizedSearchTerm) {
      return [];
    }
    return logLines
      .map((line, index) =>
        line.toLowerCase().includes(normalizedSearchTerm) ? index : null,
      )
      .filter((index): index is number => index !== null);
  }, [logLines, normalizedSearchTerm]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [activeSearchTerm, log]);

  useEffect(() => {
    if (activeMatchIndex >= matchingLineIndexes.length) {
      setActiveMatchIndex(0);
    }
  }, [activeMatchIndex, matchingLineIndexes.length]);

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
        description={error.cause?.toString()}
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
    <PortalCard
      type="inner"
      styles={{
        body: {
          padding: "0px",
        },
      }}
      className={!error ? styles.compactCard : undefined}
      icon={<FileSearchOutlined />}
      titleBits={[title]}
      extraBits={[
        logDownloadUrl && (
          <Button key="download" icon={<DownloadOutlined />} type="primary">
            <a
              href={logDownloadUrl}
              download={fileName || "log.txt"}
              target="_self"
            >
              Download Log
            </a>
          </Button>
        ),
        log && (
          <Button key="copy" type="primary" onClick={() => copyToClipboard(log)}>
            Copy to clipboard
          </Button>
        ),
      ]}
    >
      <div className={styles.toolbar}>
        <Space size="small" className={styles.searchControls} wrap>
          <Input.Search
            allowClear
            placeholder="Search log"
            size="small"
            className={styles.searchInput}
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onSearch={() => setActiveSearchTerm(searchDraft)}
          />
          <Button
            size="small"
            disabled={matchingLineIndexes.length === 0}
            onClick={() =>
              setActiveMatchIndex((current) =>
                matchingLineIndexes.length === 0
                  ? 0
                  : (current - 1 + matchingLineIndexes.length) %
                    matchingLineIndexes.length,
              )
            }
          >
            Previous
          </Button>
          <Button
            size="small"
            disabled={matchingLineIndexes.length === 0}
            onClick={() =>
              setActiveMatchIndex((current) =>
                matchingLineIndexes.length === 0
                  ? 0
                  : (current + 1) % matchingLineIndexes.length,
              )
            }
          >
            Next
          </Button>
          {activeSearchTerm && (
            <Typography.Text type="secondary">
              {matchingLineIndexes.length > 0
                ? `${activeMatchIndex + 1}/${matchingLineIndexes.length}`
                : "0/0"}
            </Typography.Text>
          )}
        </Space>
      </div>
      <AnsiScrollingWindow
        log={log}
        activeLineIndex={
          matchingLineIndexes.length > 0
            ? matchingLineIndexes[activeMatchIndex]
            : undefined
        }
        matchedLineIndexes={matchingLineIndexes}
      />
    </PortalCard>
  );
};

export { LogViewerCard };
