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
}

const LogViewer: React.FC<Props> = ({ log, loading, error }) => {
  const html = React.useMemo(() => {
    if (!log) return "";
    return ansi.ansi_to_html(log);
  }, [log]);

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
      className={styles.logContainer}
      // TODO: Remove the danger
      // biome-ignore lint/security/noDangerouslySetInnerHTML: Should be reworked
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default LogViewer;
