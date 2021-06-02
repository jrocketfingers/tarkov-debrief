export enum ToolType {
  select = "select",
  pencil = "pencil",
  eraser = "eraser",
  marker = "marker",
  pan = "pan",
}

export type Tool = {
  active: boolean;
  type: ToolType;
  cursor: null | string;
};

export type SetToolFn = (tool: Tool) => void;
