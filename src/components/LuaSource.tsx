import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { EditorView } from "@codemirror/view";

const LUA = [StreamLanguage.define(lua), EditorView.lineWrapping];

export function LuaSource({ value }: { value: string }) {
  return (
    <div className="lua-preview">
      <CodeMirror
        value={value}
        height="auto"
        theme="dark"
        extensions={LUA}
        editable={false}
        readOnly
        basicSetup
      />
    </div>
  );
}
