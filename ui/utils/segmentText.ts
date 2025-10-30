export type Granularity = 'full' | 'paragraph' | 'sentence' | 'word';

export interface TextSegment {
  id: string;
  text: string;
  start: number;
  end: number;
  type: Granularity;
}

export const segmentText = (text: string, granularity: Granularity): TextSegment[] => {
  if (!text) return [];
  
  switch (granularity) {
    case 'full':
      return [{
        id: '0',
        text,
        start: 0,
        end: text.length,
        type: 'full'
      }];
      
    case 'paragraph':
      const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
      let offset = 0;
      return paragraphs.map((para, idx) => {
        const start = text.indexOf(para.trim(), offset);
        const end = start + para.trim().length;
        offset = end;
        return {
          id: `p-${idx}`,
          text: para.trim(),
          start,
          end,
          type: 'paragraph'
        };
      });
      
    case 'sentence':
      // Simple sentence split - in production use Intl.Segmenter
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
      let sOffset = 0;
      return sentences.map((sent, idx) => {
        const trimmed = sent.trim();
        const start = text.indexOf(trimmed, sOffset);
        const end = start + trimmed.length;
        sOffset = end;
        return {
          id: `s-${idx}`,
          text: trimmed,
          start,
          end,
          type: 'sentence'
        };
      });
      
    case 'word':
      const words = text.split(/\s+/).filter(w => w.length > 0);
      let wOffset = 0;
      return words.map((word, idx) => {
        const start = text.indexOf(word, wOffset);
        const end = start + word.length;
        wOffset = end;
        return {
          id: `w-${idx}`,
          text: word,
          start,
          end,
          type: 'word'
        };
      });
      
    default:
      return [];
  }
};