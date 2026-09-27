export function Highlight({ text }: { text: string }) {
  const parts = text.split(/(<mark>.*?<\/mark>)/g).filter((part) => part.length > 0);
  return (
    <>
      {parts.map((part, index) => {
        const match = /^<mark>(.*)<\/mark>$/.exec(part);
        return match ? <mark key={index}>{match[1]}</mark> : <span key={index}>{part}</span>;
      })}
    </>
  );
}
