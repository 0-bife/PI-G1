import { Search, MoreHorizontal } from 'lucide-react';
import PageHeading from '../components/PageHeading.jsx';
import { contacts } from '../data/mockData.js';

// Contatos: busca, filtros e tabela de clientes/leads.
export default function Contatos() {
	return (
		<>
			<PageHeading
				title="Contatos"
				text="Organize clientes, leads e oportunidades."
				button="Novo contato"
			/>

			<div className="toolbar card">
				<div className="search-box wide">
					<Search size={17} />
					<input placeholder="Buscar por nome, telefone ou empresa..." />
				</div>

				<select>
					<option>Todos os status</option>
				</select>

				<select>
					<option>Todas as etiquetas</option>
				</select>
			</div>

			<div className="card table-wrap">
				<table>
					<thead>
						<tr>
							<th>Nome</th>
							<th>Telefone</th>
							<th>Empresa</th>
							<th>Último contato</th>
							<th>Status</th>
							<th></th>
						</tr>
					</thead>

					<tbody>
						{contacts.map((contact, index) => (
							<tr key={contact[0]}>
								<td>
									<div className="name-cell">
										<div className="avatar pale">
											{contact[0]
												.split(' ')
												.map((part) => part[0])
												.join('')}
										</div>
										<strong>{contact[0]}</strong>
									</div>
								</td>

								{contact.slice(1, 4).map((value) => (
									<td key={value}>{value}</td>
								))}

								<td>
									<span className={`tag ${index === 4 ? '' : 'success'}`}>
										{contact[4]}
									</span>
								</td>

								<td>
									<MoreHorizontal size={18} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}
