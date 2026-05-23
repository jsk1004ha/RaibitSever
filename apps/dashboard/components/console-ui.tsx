type JsonCardProps = {
  title: string;
  value: any;
};

export function JsonCard({ title, value }: JsonCardProps) {
  return (
    <article style={jsonCardStyle}>
      <h2>{title}</h2>
      <pre style={jsonPreStyle}>{JSON.stringify(value, null, 2)}</pre>
    </article>
  );
}

const jsonCardStyle = { border: '1px solid #dbeafe', borderRadius: 16, padding: 20, background: '#fff' } as const;
const jsonPreStyle = { whiteSpace: 'pre-wrap', overflowX: 'auto', background: '#0f172a', color: '#dbeafe', padding: 12, borderRadius: 10 } as const;
