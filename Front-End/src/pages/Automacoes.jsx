import { Zap, MessageCircle, ChevronRight, Bot, Tag, Users } from 'lucide-react';
import PageHeading from '../components/PageHeading.jsx';

// Automações: fluxos automáticos e exemplo visual de chatbot.
export default function Automacoes() {
	return (
		<>
			<PageHeading
				title="Automações"
				text="Automatize respostas e organize o fluxo de atendimento."
				button="Nova automação"
			/>

			<div className="automation-grid">
				{[
					['Mensagem de boas-vindas', 'Envia uma saudação no primeiro contato', true],
					['Fora do horário', 'Informa o horário de atendimento', true],
					['Encaminhar para Comercial', 'Direciona leads qualificados ao setor', false],
				].map((automation) => (
					<article className="card automation" key={automation[0]}>
						<div className="automation-icon">
							<Zap />
						</div>

						<div className="grow">
							<h3>{automation[0]}</h3>
							<p>{automation[1]}</p>
						</div>

						<label className="switch">
							<input type="checkbox" defaultChecked={automation[2]} />
							<span />
						</label>
					</article>
				))}
			</div>

			<article className="card flow">
				<div className="card-head">
					<div>
						<h3>Fluxo: Primeiro atendimento</h3>
						<p>Exemplo visual simplificado</p>
					</div>

					<span className="tag success">Ativo</span>
				</div>

				<div className="flow-row">
					<div className="flow-node">
						<MessageCircle />
						<span>
							<small>GATILHO</small>
							Nova mensagem
						</span>
					</div>

					<ChevronRight />

					<div className="flow-node">
						<Bot />
						<span>
							<small>AÇÃO</small>
							Boas-vindas
						</span>
					</div>

					<ChevronRight />

					<div className="flow-node">
						<Tag />
						<span>
							<small>CONDIÇÃO</small>
							Assunto comercial?
						</span>
					</div>

					<ChevronRight />

					<div className="flow-node">
						<Users />
						<span>
							<small>AÇÃO</small>
							Enviar ao setor
						</span>
					</div>
				</div>
			</article>
		</>
	);
}
