import { WarningOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Descriptions,
  Divider,
  Flex,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { BazelInvocationActionsFragment } from "@/graphql/__generated__/graphql";
import { casByteStreamClient } from "@/grpc/casByteStreamClient";
import { digestFunction_ValueFromJSON } from "@/lib/grpc-client/build/bazel/remote/execution/v2/remote_execution";
import type { ByteStreamClient } from "@/lib/grpc-client/google/bytestream/bytestream";
import { parseBytestreamUri } from "@/utils/bytestreamUri";
import { digestFunctionValueFromString } from "@/utils/digestFunctionUtils";
import { fetchCasObject } from "@/utils/fetchCasObject";
import { readableFileSize } from "@/utils/filesize";
import { generateFileUrl } from "@/utils/urlGenerator";
import { LogViewerCard } from "../LogViewer";

const SIZE_BYTE_LIMIT = 5 * 1024 * 1024; // 5MiB

const fetchLog = async (
  casByteStreamClient: ByteStreamClient,
  instanceName: string,
  digestFunction: string | undefined | null,
  digest: string | undefined | null,
  sizeBytes: number | undefined | null,
): Promise<string | undefined> => {
  if (!digest || !sizeBytes || !digestFunction || sizeBytes > SIZE_BYTE_LIMIT) {
    return undefined;
  }

  const data = await fetchCasObject(
    casByteStreamClient,
    instanceName,
    digestFunction_ValueFromJSON(digestFunction.toUpperCase()),
    {
      hash: digest,
      sizeBytes: sizeBytes.toString(),
    },
  );
  return new TextDecoder().decode(data);
};

const renderActionFileLink = (
  file: { name: string; uri?: string | null },
  actionLabel: string,
) => {
  if (!file.uri) {
    return (
      <Typography.Text type="secondary" key={file.name}>
        {file.name}
      </Typography.Text>
    );
  }

  const parsed = parseBytestreamUri(file.uri);
  if (!parsed) {
    return (
      <Typography.Text type="secondary" key={file.name}>
        {file.name}
      </Typography.Text>
    );
  }

  return (
    <a
      key={file.name}
      href={generateFileUrl(
        parsed.instanceName,
        parsed.digestFunction,
        parsed.digest,
        file.name,
      )}
      download={`${actionLabel}-${file.name}`}
      target="_self"
      rel="noreferrer"
    >
      {file.name}
    </a>
  );
};

const renderValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return `${value}`;
};

const renderDigest = (
  digestFunction: string | undefined | null,
  hash: string | undefined | null,
  sizeBytes: number | undefined | null,
  fileName: string,
  instanceName: string,
) => {
  if (!digestFunction || !hash || !sizeBytes) {
    return "-";
  }
  return (
    <Space direction="vertical" size={0}>
      <Typography.Text code copyable={{ text: hash }}>
        {hash}
      </Typography.Text>
      <a
        href={generateFileUrl(
          instanceName,
          digestFunctionValueFromString(digestFunction),
          {
            hash,
            sizeBytes: sizeBytes.toString(),
          },
          fileName,
        )}
        target="_self"
        rel="noreferrer"
      >
        {digestFunction} / {readableFileSize(sizeBytes)}
      </a>
    </Space>
  );
};

interface Props {
  instanceName: string;
  action: BazelInvocationActionsFragment;
}

export const ActionDetails: React.FC<Props> = ({ instanceName, action }) => {
  const { data } = useQuery({
    queryKey: ["actionLogs", action.id],
    queryFn: async () => {
      const stdoutPromise = fetchLog(
        casByteStreamClient,
        instanceName,
        action.stdoutHashFunction,
        action.stdoutHash,
        action.stdoutSizeBytes,
      );
      const stderrPromise = fetchLog(
        casByteStreamClient,
        instanceName,
        action.stderrHashFunction,
        action.stderrHash,
        action.stderrSizeBytes,
      );
      const [stdout, stderr] = await Promise.all([
        stdoutPromise,
        stderrPromise,
      ]);

      // Regex to match historical_execute_response URLs
      const re =
        /https?:\/\/[-a-zA-Z0-9.]{1,256}(:[0-9]+)?[-a-zA-Z0-9()@:%_+.~#?&/=]*\/blobs\/[a-zA-Z0-9]{0,20}\/historical_execute_response\/[0-9a-f]{64}-[0-9]*\//;
      const historicalUrl = stdout?.match(re)?.[0] || stderr?.match(re)?.[0];

      return { stdout, stderr, historicalUrl };
    },
  });

  const validActionOutputLink =
    action.stdoutHash && action.stdoutHashFunction && action.stdoutSizeBytes;
  const validErrorOutputLink =
    action.stderrHash && action.stderrHashFunction && action.stderrSizeBytes;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Descriptions
        title="Action"
        bordered
        column={1}
        size="small"
        styles={{ label: { width: "20%" }, content: { width: "90%" } }}
      >
        <Descriptions.Item label="ID">
          <Typography.Text copyable={{ text: action.id }}>
            {action.id}
          </Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="Label">
          <Typography.Text copyable={{ text: action.label }}>
            {action.label}
          </Typography.Text>
        </Descriptions.Item>
        {action.type && (
          <Descriptions.Item label="Type">{action.type}</Descriptions.Item>
        )}
        {action.success !== null && action.success !== undefined && (
          <Descriptions.Item label="Success">
            {action.success ? "Yes" : "No"}
          </Descriptions.Item>
        )}
        {action.exitCode !== null && action.exitCode !== undefined && (
          <Descriptions.Item label="Exit Code">
            {action.exitCode}
          </Descriptions.Item>
        )}
        {action.failureCode && (
          <Descriptions.Item label="Failure Code">
            {action.failureCode}
          </Descriptions.Item>
        )}
        {action.failureMessage && (
          <Descriptions.Item label="Failure Message">
            {action.failureMessage}
          </Descriptions.Item>
        )}
        {action.startTime && (
          <Descriptions.Item label="Started">{action.startTime}</Descriptions.Item>
        )}
        {action.endTime && (
          <Descriptions.Item label="Finished">{action.endTime}</Descriptions.Item>
        )}
        {action.commandLine && (
          <Descriptions.Item label="Command Line">
            <Flex wrap>
              {action.commandLine.map((arg, index) => (
                <pre
                  // biome-ignore lint/suspicious/noArrayIndexKey: Since there are duplicate args, use the index.
                  key={`${arg}-${index}`}
                  style={{ textWrap: "wrap", paddingRight: "0.7em" }}
                >
                  {index === 0 ? <strong>{arg}</strong> : arg}
                </pre>
              ))}
            </Flex>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="Stdout Digest">
          {renderDigest(
            action.stdoutHashFunction,
            action.stdoutHash,
            action.stdoutSizeBytes,
            "standard_output",
            instanceName,
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Stderr Digest">
          {renderDigest(
            action.stderrHashFunction,
            action.stderrHash,
            action.stderrSizeBytes,
            "error_output",
            instanceName,
          )}
        </Descriptions.Item>
      </Descriptions>
      <Descriptions
        title="Configuration"
        bordered
        column={1}
        size="small"
        styles={{ label: { width: "20%" }, content: { width: "90%" } }}
      >
        <Descriptions.Item label="Configuration ID">
          {action.configuration?.configurationID ?? "-"}
        </Descriptions.Item>
        {action.configuration?.cpu && (
          <Descriptions.Item label="Configuration CPU">
            {action.configuration.cpu}
          </Descriptions.Item>
        )}
        {action.configuration?.platformName && (
          <Descriptions.Item label="Configuration Platform Name">
            {action.configuration.platformName}
          </Descriptions.Item>
        )}
        {action.configuration?.mnemonic && (
          <Descriptions.Item label="Configuration Mnemonic">
            {action.configuration.mnemonic}
          </Descriptions.Item>
        )}
        {action.configuration?.makeVariables &&
          Object.keys(action.configuration.makeVariables).length > 0 && (
            <Descriptions.Item label="Configuration Make Variables">
              <Space direction="vertical" size="small">
                {Object.entries(action.configuration.makeVariables).map(
                  ([key, value]) => (
                    <span key={key}>
                      <strong>{key}=</strong>
                      {`${value}`}
                    </span>
                  ),
                )}
              </Space>
            </Descriptions.Item>
          )}
      </Descriptions>
      {Array.isArray(action.completedActions) &&
        action.completedActions.length > 0 && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Divider orientation="left">Completed Actions</Divider>
            {action.completedActions.map((completedAction) => (
              <Descriptions
                key={completedAction.id}
                bordered
                column={1}
                size="small"
                styles={{ label: { width: "20%" }, content: { width: "90%" } }}
                title={
                  <Space size="small" wrap>
                    <Typography.Text copyable={{ text: completedAction.uuid }}>
                      {completedAction.uuid}
                    </Typography.Text>
                    {completedAction.cacheHit !== null &&
                      completedAction.cacheHit !== undefined && (
                        <Tag color={completedAction.cacheHit ? "blue" : "orange"}>
                          {completedAction.cacheHit ? "Cache hit" : "Executed"}
                        </Tag>
                      )}
                    {completedAction.exitCode !== null &&
                      completedAction.exitCode !== undefined && (
                        <Tag color={completedAction.exitCode === 0 ? "green" : "red"}>
                          Exit {completedAction.exitCode}
                        </Tag>
                      )}
                  </Space>
                }
              >
                <Descriptions.Item label="Instance Name">
                  {renderValue(completedAction.instanceName)}
                </Descriptions.Item>
                <Descriptions.Item label="Action Digest">
                  {renderDigest(
                    completedAction.digestFunction,
                    completedAction.actionDigestHash,
                    completedAction.actionDigestSizeBytes,
                    "action",
                    instanceName,
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Tool Invocation ID">
                  {renderValue(completedAction.toolInvocationID)}
                </Descriptions.Item>
                <Descriptions.Item label="Correlated Invocations ID">
                  {renderValue(completedAction.correlatedInvocationsID)}
                </Descriptions.Item>
                <Descriptions.Item label="Target ID">
                  {renderValue(completedAction.targetID)}
                </Descriptions.Item>
                <Descriptions.Item label="Action Mnemonic">
                  {renderValue(completedAction.actionMnemonic)}
                </Descriptions.Item>
                <Descriptions.Item label="Cache Hit">
                  {renderValue(completedAction.cacheHit)}
                </Descriptions.Item>
                <Descriptions.Item label="Exit Code">
                  {renderValue(completedAction.exitCode)}
                </Descriptions.Item>
                <Descriptions.Item label="Status Code">
                  {renderValue(completedAction.statusCode)}
                </Descriptions.Item>
                <Descriptions.Item label="Status Message">
                  {renderValue(completedAction.statusMessage)}
                </Descriptions.Item>
                <Descriptions.Item label="Queued At">
                  {renderValue(completedAction.queuedAt)}
                </Descriptions.Item>
                <Descriptions.Item label="Worker Started At">
                  {renderValue(completedAction.workerStartAt)}
                </Descriptions.Item>
                <Descriptions.Item label="Worker Completed At">
                  {renderValue(completedAction.workerCompletedAt)}
                </Descriptions.Item>
                <Descriptions.Item label="Uploaded At">
                  {renderValue(completedAction.uploadedAt)}
                </Descriptions.Item>
                <Descriptions.Item label="Stdout Digest">
                  {renderDigest(
                    completedAction.digestFunction,
                    completedAction.stdoutHash,
                    completedAction.stdoutSizeBytes,
                    "completed_action_stdout",
                    instanceName,
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Stderr Digest">
                  {renderDigest(
                    completedAction.digestFunction,
                    completedAction.stderrHash,
                    completedAction.stderrSizeBytes,
                    "completed_action_stderr",
                    instanceName,
                  )}
                </Descriptions.Item>
              </Descriptions>
            ))}
          </Space>
        )}
      <LogViewerCard
        log={data?.stdout}
        title="Standard output"
        logDownloadUrl={
          action.stdoutHashFunction &&
          action.stdoutHash &&
          action.stdoutSizeBytes
            ? generateFileUrl(
                instanceName,
                digestFunctionValueFromString(action.stdoutHashFunction),
                {
                  hash: action.stdoutHash,
                  sizeBytes: action.stdoutSizeBytes.toString(),
                },
                "standard_output",
              )
            : undefined
        }
        fileName="standard_output.txt"
        error={
          !data?.stdout &&
          action.stdoutSizeBytes &&
          action.stdoutSizeBytes > SIZE_BYTE_LIMIT
            ? Error("Standard output is too large to display.", {
                cause: `The standard output is ${readableFileSize(
                  action.stdoutSizeBytes,
                )}. ${validActionOutputLink && "Please download the output to view it."}`,
              })
            : undefined
        }
      />
      <LogViewerCard
        log={data?.stderr}
        title="Standard error"
        logDownloadUrl={
          action.stderrHashFunction &&
          action.stderrHash &&
          action.stderrSizeBytes
            ? generateFileUrl(
                instanceName,
                digestFunctionValueFromString(action.stderrHashFunction),
                {
                  hash: action.stderrHash,
                  sizeBytes: action.stderrSizeBytes.toString(),
                },
                "error_output",
              )
            : undefined
        }
        fileName="error_output.txt"
        error={
          !data?.stderr &&
          action.stderrSizeBytes &&
          action.stderrSizeBytes > SIZE_BYTE_LIMIT
            ? Error("Standard error is too large to display.", {
                cause: `The standard error output is ${readableFileSize(
                  action.stderrSizeBytes,
                )}. ${validErrorOutputLink && "Please download the output to view it."}`,
              })
            : undefined
        }
      />
      {Array.isArray(action.actionFiles) && action.actionFiles.length > 0 && (
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Typography.Text strong>Files</Typography.Text>
          <Space direction="vertical" size={2}>
            {[...action.actionFiles]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((file) => renderActionFileLink(file, action.label))}
          </Space>
        </Space>
      )}
      {data?.historicalUrl && (
        <Space
          size="small"
          direction="vertical"
          style={{ width: "100%" }}
          align="end"
        >
          <Tooltip title="This URL was extracted from the action's stdout or stderr, so there are no guarantees that it is correct. It points to a historical execute response stored in the CAS.">
            <Button
              type="primary"
              href={data.historicalUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View Historical Execute Response
              <WarningOutlined />
            </Button>
          </Tooltip>
        </Space>
      )}
    </Space>
  );
};
