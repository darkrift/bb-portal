import {
  CheckCircleFilled,
  CloseCircleFilled,
  QuestionCircleFilled,
} from "@ant-design/icons";
import { Collapse, Space, Tag, Typography } from "antd";
import { useMemo } from "react";
import type { BazelInvocationActionsFragment } from "@/graphql/__generated__/graphql";
import ResultTag from "@/components/ResultTag";
import themeStyles from "@/theme/theme.module.css";
import PortalDuration from "../PortalDuration";
import { ActionDetails } from "./action";
import styles from "./index.module.css";

const ActionStatusTag: React.FC<{ status: boolean | null | undefined }> = ({
  status,
}) => {
  switch (status) {
    case true:
      return (
        <ResultTag
          tagVars={{
            color: "green",
            icon: <CheckCircleFilled />,
            text: "Succeeded",
          }}
        />
      );
    case false:
      return (
        <ResultTag
          tagVars={{
            color: "red",
            icon: <CloseCircleFilled />,
            text: "Failed",
          }}
        />
      );
    default:
      return (
        <ResultTag
          tagVars={{
            color: "orange",
            icon: <QuestionCircleFilled />,
            text: "Unknown",
          }}
        />
      );
  }
};

const getCollapseItems = (
  instanceName: string,
  actions: BazelInvocationActionsFragment[],
) => {
  return actions?.map((action) => {
    return {
      key: action.id,
      label: (
        <Space size="small" wrap>
          <Typography.Text>{action.label}</Typography.Text>
          {action.type && <Tag className={styles.actionTypeTag}>{action.type}</Tag>}
          <ActionStatusTag status={action.success} />
        </Space>
      ),
      extra: action.startTime && action.endTime && (
        <PortalDuration
          from={action.startTime || undefined}
          to={action.endTime || undefined}
          formatConfig={{ smallestUnit: "ms" }}
        />
      ),
      children: <ActionDetails instanceName={instanceName} action={action} />,
    };
  });
};

interface Props {
  instanceName: string;
  actions: BazelInvocationActionsFragment[];
}

export const ActionsTab: React.FC<Props> = ({ instanceName, actions }) => {
  const items = useMemo(
    () => getCollapseItems(instanceName, actions),
    [instanceName, actions],
  );
  return (
    <Collapse
      items={items}
      bordered={true}
      defaultActiveKey={actions && actions.length === 1 ? [actions[0].id] : []}
      className={themeStyles.collapse}
    />
  );
};
