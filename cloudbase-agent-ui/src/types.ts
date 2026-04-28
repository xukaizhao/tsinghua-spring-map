export type ToolCardProps = {
  toolName?: string;
  name?: string;
  tool?: {
    name?: string;
  };
  message?: {
    toolName?: string;
    tool?: {
      name?: string;
    };
    result?: unknown;
    output?: unknown;
  };
  result?: unknown;
  output?: unknown;
  data?: unknown;
};
