export default function Panel({
  title,
  description,
  children,
  className = "",
  actions,
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {description && <p className="card-description">{description}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
