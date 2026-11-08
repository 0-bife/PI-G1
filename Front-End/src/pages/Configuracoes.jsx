import { useState } from 'react';
import { UserRound, Users, Plug, Bot, Tags, Shield, BellRing, ChevronRight } from 'lucide-react';
import PageHeading from '../components/PageHeading.jsx';
import {
	getAttendanceAlertMinutes,
	saveAttendanceAlertMinutes,
} from '../attendanceAlertConfig.js';

// Configurações: navegação por seções e formulário de preferências.
export default function Configuracoes() {
	const sections = [
		['Perfil', UserRound],
		['Equipe', Users],
		['Integrações', Plug],
		['Mensagens automáticas', Bot],
		['Etiquetas', Tags],
		['Segurança', Shield],
		['Alertas de atendimento', BellRing],
	];

	const [tab, setTab] = useState('Perfil');
	const [alertMinutes, setAlertMinutes] = useState(() => getAttendanceAlertMinutes());

	function handleSave() {
		if (tab !== 'Alertas de atendimento') return;
		const minutes = Number(alertMinutes);
		if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) return;
		saveAttendanceAlertMinutes(minutes);
		window.dispatchEvent(new Event('inablink:attendance-alert-config-changed'));
	}

	return (
		<>
			<PageHeading
				title="Configurações"
				text="Personalize sua conta, equipe e preferências."
			/>

			<div className="settings-layout">
				<aside className="card settings-nav">
					{sections.map(([section, Icon]) => (
						<button
							className={tab === section ? 'active' : ''}
							onClick={() => setTab(section)}
							key={section}
						>
							<Icon size={18} />
							{section}
							<ChevronRight size={16} />
						</button>
					))}
				</aside>

				<article className="card settings-form">
					<span className="eyebrow">CONFIGURAÇÕES</span>
					<h3>{tab}</h3>
					<p>Gerencie as preferências de {tab.toLowerCase()} da sua empresa.</p>

					{tab === 'Alertas de atendimento' ? (
						<div className="form-grid settings-fields">
							<label>
								Tempo sem resposta (minutos)
								<input
									type="number"
									min="1"
									max="10080"
									value={alertMinutes}
									onChange={(event) => setAlertMinutes(event.target.value)}
								/>
								<small className="field-help">
									Alertar para atendimentos abertos sem resposta após esse período.
								</small>
							</label>
						</div>
					) : (
						<div className="form-grid settings-fields">
						<label>
							Nome da empresa
							<input defaultValue="in a blink Demo" />
						</label>

						<label>
							E-mail de contato
							<input defaultValue="contato@inablink.com" />
						</label>

						<label>
							Telefone
							<input defaultValue="+55 (19) 99999-0000" />
						</label>

						<label>
							Fuso horário
							<select>
								<option>Brasília (GMT-3)</option>
							</select>
						</label>

						<label className="full-span toggle-line">
							<span>
								<strong>Notificações da plataforma</strong>
								<small>Receber alertas importantes da operação.</small>
							</span>

							<span className="switch">
								<input type="checkbox" defaultChecked />
								<i />
							</span>
						</label>
						</div>
					)}

					<button className="primary" type="button" onClick={handleSave}>
						Salvar alterações
					</button>
				</article>
			</div>
		</>
	);
}
