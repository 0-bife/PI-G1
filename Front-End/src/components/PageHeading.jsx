import { Plus } from 'lucide-react';
// Cabeçalho padrão das páginas internas.
export default function PageHeading({title,text,button}){return <div className="page-heading"><div><span className="eyebrow">IN A BLINK</span><h2>{title}</h2><p>{text}</p></div>{button&&<button className="primary"><Plus size={18}/>{button}</button>}</div>}
