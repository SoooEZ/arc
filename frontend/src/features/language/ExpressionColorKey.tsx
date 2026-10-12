/**
 * Labels keep symbol roles understandable without relying on color alone. The
 * roles take their colors from the tokens the Monaco theme reads (tokens.css).
 */
export default function ExpressionColorKey() {
  return (
    <div className="expression-color-key" aria-label="Expression color key">
      <span data-role="function">$ Function</span>
      <span data-role="formula">@ Formula</span>
      <span data-role="parameter">Input</span>
      <span data-role="result">Node result</span>
    </div>
  );
}
