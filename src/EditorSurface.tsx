import Editor, { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

loader.config({ monaco });

type Props = {
  mode: "file" | "diff";
  language: string;
  content: string;
  original: string;
  onChange: (value: string | undefined) => void;
};

export default function EditorSurface({ mode, language, content, original, onChange }: Props) {
  const options = {
    minimap: { enabled: false },
    fontSize: 13,
    automaticLayout: true,
  };
  return mode === "file" ? (
    <Editor height="100%" theme="vs-dark" language={language} value={content} onChange={onChange} options={{ ...options, tabSize: 2 }} />
  ) : (
    <DiffEditor height="100%" theme="vs-dark" language={language} original={original} modified={content} options={{ ...options, readOnly: true }} />
  );
}
