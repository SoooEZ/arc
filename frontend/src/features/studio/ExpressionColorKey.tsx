/** Labels keep symbol roles understandable without relying on color alone. */
export default function ExpressionColorKey() {
  return (
    <div className="expression-color-key" aria-label="Expression color key">
      <span style={{ color: "#8B682F" }}>$ Function</span>
      <span style={{ color: "#007C83" }}>@ Formula</span>
      <span style={{ color: "#205FA6" }}>Input</span>
      <span style={{ color: "#7B3F98" }}>Node result</span>
    </div>
  );
}
