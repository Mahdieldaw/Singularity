import React, { useEffect, useImperativeHandle } from 'react';
import { EditorContent, useEditor, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
// Removed drag-and-drop and legacy composer extensions for a cleaner editor
import { ScratchpadComposedNode } from '../ScratchpadComposedNode';
import type { ProvenanceData } from './extensions/ComposedContentNode';

export interface CanvasEditorRef {
  insertComposedContent: (content: string, provenance: ProvenanceData, position?: number) => void;
  insertAtCoords: (left: number, top: number, content: JSONContent) => void;
  getPosAtCoords: (left: number, top: number) => number | undefined;
  getCoordsAtPos: (pos: number) => { left: number; right: number; top: number; bottom: number } | undefined;
  getSelectionText: () => string;
  getSelectionRange: () => { from: number; to: number } | null;
  deleteRange: (from: number, to: number) => void;
  setContent: (content: JSONContent) => void;
  getContent: () => JSONContent;
  getText: () => string;
  clear: () => void;
  focus: () => void;
}

interface CanvasEditorProps {
  content?: string;
  initialText?: string;
  initialContent?: JSONContent;
  placeholder?: string;
  onChange?: (content: JSONContent) => void;
  className?: string;
  onInteraction?: () => void;
  onSelectionChange?: (sel: { from: number; to: number; text: string }) => void;
}

export const CanvasEditorV2 = React.forwardRef<CanvasEditorRef, CanvasEditorProps>((props, ref) => {
  const { content, initialText } = props;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Placeholder.configure({
        placeholder: props.placeholder || 'Click to place content here…',
        emptyEditorClass: 'is-editor-empty',
      }),
      ScratchpadComposedNode,
      // Rely on TipTap's natural splitting and behavior; no legacy composer extension
    ],
    content: props.initialContent ?? content ?? initialText ?? '',
    onUpdate: ({ editor }) => {
      props.onChange?.(editor.getJSON());
      props.onInteraction?.();
    },
    editorProps: {
      attributes: {
        class: `prose prose-sm focus:outline-none ${props.className || ''}`,
        style: 'min-height: 100%; padding: 12px; cursor: text; width: 100%; font-size: 14px;',
      },
      handleDrop: () => false,
      handleClick: (view) => { view.focus(); return false; },
    }
  });

  useImperativeHandle(ref, () => ({
    insertComposedContent: (text: string, provenance: ProvenanceData, position?: number) => {
      if (!editor) return;
      const providerId = (provenance as any)?.providerId || 'unknown';
      const turnId = (provenance as any)?.aiTurnId || (provenance as any)?.userTurnId || '';
      const responseType = (provenance as any)?.responseType || 'batch';
      const sessionId = (provenance as any)?.sessionId || 'unknown';
      const node: JSONContent = {
        type: 'scratchpadBlock',
        attrs: { providerId, turnId, responseType, sessionId },
        content: [{ type: 'text', text }]
      };
      if (typeof position === 'number') {
        editor.chain().focus().insertContentAt(position, node).run();
      } else {
        editor.chain().focus().insertContent(node).run();
      }
    },
    // Precise insertion by viewport coordinates
    insertAtCoords: (left: number, top: number, content: JSONContent) => {
      if (!editor) return;
      const view = (editor as any).view;
      if (!view || typeof view.posAtCoords !== 'function') {
        editor.chain().focus().insertContent(content).run();
        return;
      }
      const pos = view.posAtCoords({ left, top });
      const insertPos = pos?.pos ?? undefined;
      if (typeof insertPos === 'number') {
        editor.chain().focus().insertContentAt(insertPos, content).run();
      } else {
        editor.chain().focus().insertContent(content).run();
      }
    },
    getPosAtCoords: (left: number, top: number) => {
      if (!editor) return undefined;
      const view = (editor as any).view;
      const pos = view?.posAtCoords ? view.posAtCoords({ left, top }) : null;
      return pos?.pos ?? undefined;
    },
    getCoordsAtPos: (pos: number) => {
      if (!editor || typeof pos !== 'number') return undefined;
      const view = (editor as any).view;
      if (!view || typeof view.coordsAtPos !== 'function') return undefined;
      try {
        const rect = view.coordsAtPos(pos);
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } as any;
      } catch { return undefined; }
    },
    getSelectionText: () => {
      const state = (editor as any)?.state;
      const sel = state?.selection;
      if (!sel) return '';
      return state.doc?.textBetween(sel.from, sel.to, '\n') || '';
    },
    getSelectionRange: () => {
      const state = (editor as any)?.state;
      const sel = state?.selection;
      if (!sel) return null;
      return { from: sel.from, to: sel.to };
    },
    deleteRange: (from: number, to: number) => {
      if (!editor || typeof from !== 'number' || typeof to !== 'number') return;
      editor.chain().focus().deleteRange({ from, to }).run();
    },
    setContent: (json: JSONContent) => {
      if (!editor) return;
      editor.commands.setContent(json);
    },
    getContent: () => editor?.getJSON() || { type: 'doc', content: [] },
    getText: () => editor?.getText() || '',
    clear: () => editor?.commands.clearContent(),
    focus: () => editor?.commands.focus(),
  }), [editor]);

  useEffect(() => {
    if (editor && props.initialContent) {
      editor.commands.setContent(props.initialContent);
    }
  }, [editor, props.initialContent]);

  useEffect(() => {
    if (!editor) return;
    const notify = () => props.onInteraction?.();
    editor.on('focus', notify);
    editor.on('selectionUpdate', notify);
    const onSel = () => {
      try {
        const state = (editor as any).state;
        const sel = state?.selection;
        if (!sel) return;
        const from = sel.from;
        const to = sel.to;
        const text = state.doc?.textBetween(from, to, '\n') || '';
        props.onSelectionChange?.({ from, to, text });
      } catch {}
    };
    editor.on('selectionUpdate', onSel);
    // ensure typing is already covered by onUpdate
    return () => {
      editor.off('focus', notify);
      editor.off('selectionUpdate', notify);
      editor.off('selectionUpdate', onSel);
    };
  }, [editor, props.onInteraction, props.onSelectionChange]);

  // Removed droppable overlay and drag-related code for a cleaner editor

  return (
    <div
      className="canvas-editor-container"
      style={{
        position: 'relative',
        borderRadius: '8px',
        padding: '8px',
        height: '100%',
        minHeight: '160px',
        background: 'rgba(2, 6, 23, 0.6)',
        border: '1px solid rgba(148, 163, 184, 0.15)',
        display: 'flex',
        flexDirection: 'column'
      }}
      onClick={() => editor?.commands.focus()}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        <EditorContent editor={editor} />
      </div>
      {/* ProseMirror white-space guidance */}
      <style>
        {`
          .canvas-editor-container .ProseMirror {
            white-space: pre-wrap;
            word-wrap: break-word;
            height: 100%;
            min-height: 140px;
          }
          .canvas-editor-container .is-editor-empty::before {
            content: attr(data-placeholder);
            color: #64748b;
            pointer-events: none;
            float: left;
            height: 0;
          }
        `}
      </style>
    </div>
  );
});

CanvasEditorV2.displayName = 'CanvasEditorV2';

export default CanvasEditorV2;