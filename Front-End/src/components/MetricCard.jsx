// Card reutilizável para indicadores numéricos.
export default function MetricCard({ title, value, detail, Icon }) {
  return <article className="card metric"><div className="metric-icon"><Icon size={21}/></div><div><p>{title}</p><h3>{value}</h3><small>{detail}</small></div></article>;
}
