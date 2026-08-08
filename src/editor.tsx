import React from "react";
import Editor, { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

loader.config({ monaco });

export function CodeEditor(props: React.ComponentProps<typeof Editor>) {
  return <Editor {...props} />;
}

export function CodeDiffEditor(
  props: React.ComponentProps<typeof DiffEditor>,
) {
  return <DiffEditor {...props} />;
}
