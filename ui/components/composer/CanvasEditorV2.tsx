import React, { useEffect, useImperativeHandle, useMemo } from 'react';
import { EditorContent, useEditor, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useDroppable } from '@dnd-kit/core';
import { ComposedContent } from './extensions/ComposedContentNode';
import { ProvenanceExtension } from './extensions/ProvenanceExtension';
import type { ProvenanceData } from './extensions/ComposedContentNode';

export interface CanvasEditorRef {
  insertComposedContent: (content: string, provenance: ProvenanceData, position?: number) => void;
  setContent: (content: JSONContent) => void;
  getContent: () => JSONContent;
  getText: () => string;
  clear: () => void;
  focus: () => void;
}

interface CanvasEditorProps {
  content?: string;
  initialText?: string;
  droppableId?: string;
  initialContent?: JSONContent;
  placeholder?: string;
  onChange?: (content: JSONContent) => void;
  onDrop?: (data: any, position: number) => void;
  className?: string;
  onInteraction?: () => void;
}

export const CanvasEditorV2 = React.forwardRef<CanvasEditorRef, CanvasEditorProps>((props, ref) => {
  const { content, initialText, droppableId = 'canvas-dropzone' } = props;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Placeholder.configure({
        placeholder: props.placeholder || 'Drag content here to start composing...',
        emptyEditorClass: 'is-editor-empty',
      }),
      ComposedContent,
      ProvenanceExtension,
    ],
    content: props.initialContent ?? content ?? initialText ?? '',
    onUpdate: ({ editor }) => {
      props.onChange?.(editor.getJSON());
      props.onInteraction?.();
    },
    editorProps: {
      attributes: {
        class: `prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none ${props.className || ''}`,
        style: 'min-height: 160px; padding: 8px;',
      },
      handleDrop: () => false,
    }
  });

  useImperativeHandle(ref, () => ({
    insertComposedContent: (text: string, provenance: ProvenanceData, position?: number) => {
      if (!editor) return;
      editor.commands.insertComposedContent({ content: text, provenance, position });
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
    // ensure typing is already covered by onUpdate
    return () => {
      editor.off('focus', notify);
      editor.off('selectionUpdate', notify);
    };
  }, [editor, props.onInteraction]);

  const { isOver, setNodeRef } = useDroppable({ id: droppableId, data: { type: 'canvas' } });

  const overlay = useMemo(() => (
    <div className="absolute inset-0 transition-all duration-150 pointer-events-none" style={{
      background: isOver ? 'rgba(99, 102, 241, 0.10)' : 'transparent',
      outline: isOver ? '2px dashed rgba(99, 102, 241, 0.7)' : 'none',
      borderRadius: '8px'
    }} />
  ), [isOver]);

  return (
    <div
      ref={setNodeRef}
      className="canvas-editor-container"
      style={{
        position: 'relative',
        borderRadius: '8px',
        padding: '8px',
        height: '100%',
        minHeight: '160px',
        background: 'rgba(2, 6, 23, 0.6)',
        border: isOver ? '2px dashed rgba(99, 102, 241, 0.7)' : '1px solid rgba(148, 163, 184, 0.15)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {overlay}
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