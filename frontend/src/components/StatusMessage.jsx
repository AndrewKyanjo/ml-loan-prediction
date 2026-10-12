export default function StatusMessage({ type = "error", children }) {
  return (
    <div
      className={`status-message ${type}`}
      role={type === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
