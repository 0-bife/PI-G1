import { useState } from 'react';
import {
	Bot,
	Bell,
	Check,
	ChevronRight,
	CircleHelp,
	MessageCircle,
	Plug,
	Shield,
	Tags,
	UserRound,
	Users,
} from 'lucide-react';
import PageHeading from '../components/PageHeading.jsx';

const sections = [
	['Perfil e conta', UserRound],
	['Notificações', Bell],
	['Privacidade', Shield],
	['Conversas e aparência', MessageCircle],
	['Equipe', Users],
	['Integrações', Plug],
	['Mensagens automáticas', Bot],
	['Etiquetas', Tags],
	['Segurança', Shield],
	['Ajuda e sobre', CircleHelp],
];

const informationalSections = {
	Equipe: {
		title: 'Gestão da equipe',
		text: 'A gestão de usuários e permissões é feita pelas contas cadastradas no sistema. Seu perfil atual permanece vinculado à sessão autenticada.',
	},
	Integrações: {
		title: 'Integrações conectadas',
		text: 'As credenciais e conexões do WhatsApp são gerenciadas pelo servidor e não ficam expostas nas preferências do navegador.',
	},
	'Mensagens automáticas': {
		title: 'Mensagens automáticas',
		text: 'Não há uma API de automações disponível nesta versão. Nenhuma mensagem será enviada automaticamente por esta tela.',
	},
	Etiquetas: {
		title: 'Etiquetas de conversas',
		text: 'As etiquetas podem ser associadas às conversas na tela Conversas. A administração de etiquetas não está disponível nesta versão.',
	},
	Segurança: {
		title: 'Segurança da conta',
		text: 'Sua sessão é autenticada pelo servidor. Para encerrar o acesso neste dispositivo, use a opção Sair no menu lateral.',
	},
};

function Toggle({ id, title, description, checked, onChange }) {
	return (
		<div className="toggle-line">
			<span id={`${id}-label`}>
				<strong>{title}</strong>
				<small>{description}</small>
			</span>
			<label className="switch" aria-label={title}>
				<input
					id={id}
					type="checkbox"
					checked={checked}
					aria-labelledby={`${id}-label`}
					aria-checked={checked}
					onChange={(event) => onChange(event.target.checked)}
				/>
				<i aria-hidden="true" />
			</label>
		</div>
	);
}

export default function Configuracoes({ user, preferences, onSave, onReset }) {
	const [tab, setTab] = useState('Perfil e conta');
	const [draft, setDraft] = useState(preferences);
	const [feedback, setFeedback] = useState({ message: '', isError: false });

	function update(group, key, value) {
		setDraft((current) => ({
			...current,
			[group]: { ...current[group], [key]: value },
		}));
		setFeedback({ message: '', isError: false });
	}

	async function save(event) {
		event.preventDefault();
		setFeedback({ message: '', isError: false });
		try {
			await onSave(draft);
			setFeedback({ message: 'Configurações salvas com sucesso.', isError: false });
		} catch (error) {
			setFeedback({
				message: error instanceof Error ? error.message : 'Não foi possível salvar as configurações.',
				isError: true,
			});
		}
	}

	function reset() {
		try {
			const defaults = onReset();
			setDraft(defaults);
			setFeedback({ message: 'Configurações restauradas para os valores padrão.', isError: false });
		} catch (error) {
			setFeedback({
				message: error instanceof Error ? error.message : 'Não foi possível restaurar as configurações.',
				isError: true,
			});
		}
	}

	function handleAvatarChange(event) {
		const file = event.target.files?.[0];
		event.target.value = '';
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			setFeedback({ message: 'Selecione um arquivo de imagem válido.', isError: true });
			return;
		}
		if (file.size > 2 * 1024 * 1024) {
			setFeedback({ message: 'A foto deve ter no máximo 2 MB.', isError: true });
			return;
		}

		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === 'string') {
				update('profile', 'avatar', reader.result);
			} else {
				setFeedback({ message: 'Não foi possível ler a imagem selecionada.', isError: true });
			}
		};
		reader.onerror = () => {
			setFeedback({ message: 'Não foi possível ler a imagem selecionada.', isError: true });
		};
		reader.readAsDataURL(file);
	}

	const initials = (draft.profile.displayName || user?.nome || 'U')
		.trim()
		.charAt(0)
		.toLocaleUpperCase('pt-BR');

	return (
		<>
			<PageHeading
				title="Configurações"
				text="Personalize sua conta, privacidade e preferências."
			/>

			<div className="settings-layout">
				<aside className="card settings-nav" aria-label="Seções de configurações">
					{sections.map(([section, Icon]) => (
						<button
							className={tab === section ? 'active' : ''}
							type="button"
							aria-current={tab === section ? 'page' : undefined}
							onClick={() => setTab(section)}
							key={section}
						>
							<Icon size={18} aria-hidden="true" />
							{section}
							<ChevronRight size={16} aria-hidden="true" />
						</button>
					))}
				</aside>

				<article className="card settings-form">
					<span className="eyebrow">CONFIGURAÇÕES</span>
					<h3>{tab}</h3>
					<p>Gerencie suas preferências de {tab.toLocaleLowerCase('pt-BR')}.</p>

					{tab === 'Perfil e conta' && (
						<form onSubmit={save}>
							<div className="profile-photo-row">
								<div
									className="avatar settings-avatar"
									style={draft.profile.avatar ? { backgroundImage: `url("${draft.profile.avatar}")` } : undefined}
									aria-label={draft.profile.avatar ? 'Foto de perfil atual' : `Iniciais do perfil: ${initials}`}
								>
									{!draft.profile.avatar && initials}
								</div>
								<div className="profile-photo-actions">
									<strong>Foto de perfil</strong>
									<small>Imagem de até 2 MB. Fica salva neste navegador.</small>
									<div>
										<label className="secondary-button" htmlFor="profile-avatar">Alterar foto</label>
										<input
											className="visually-hidden"
											id="profile-avatar"
											type="file"
											accept="image/*"
											onChange={handleAvatarChange}
										/>
										{draft.profile.avatar && (
											<button className="text-button" type="button" onClick={() => update('profile', 'avatar', '')}>
												Remover
											</button>
										)}
									</div>
								</div>
							</div>

							<div className="form-grid settings-fields">
								<label htmlFor="profile-name">
									Nome de exibição
									<input
										id="profile-name"
										autoComplete="name"
										maxLength={80}
										value={draft.profile.displayName}
										onChange={(event) => update('profile', 'displayName', event.target.value)}
									/>
								</label>
								<label htmlFor="profile-status">
									Recado / status
									<input
										id="profile-status"
										maxLength={140}
										value={draft.profile.status}
										onChange={(event) => update('profile', 'status', event.target.value)}
									/>
								</label>
								<label htmlFor="account-email">
									E-mail vinculado
									<input id="account-email" value={user?.email ?? 'Não informado'} readOnly />
								</label>
								<label htmlFor="account-phone">
									Número vinculado
									<input id="account-phone" value="Não informado no cadastro" readOnly />
								</label>
								<label htmlFor="company-name">
									Nome da empresa
									<input
										id="company-name"
										maxLength={120}
										value={draft.company.name}
										onChange={(event) => update('company', 'name', event.target.value)}
									/>
								</label>
								<label htmlFor="company-email">
									E-mail de contato
									<input
										id="company-email"
										type="email"
										maxLength={160}
										value={draft.company.email}
										onChange={(event) => update('company', 'email', event.target.value)}
									/>
								</label>
								<label htmlFor="company-phone">
									Telefone de contato
									<input
										id="company-phone"
										type="tel"
										maxLength={30}
										value={draft.company.phone}
										onChange={(event) => update('company', 'phone', event.target.value)}
									/>
								</label>
								<label htmlFor="company-timezone">
									Fuso horário
									<select
										id="company-timezone"
										value={draft.company.timezone}
										onChange={(event) => update('company', 'timezone', event.target.value)}
									>
										<option value="America/Sao_Paulo">Brasília (GMT-3)</option>
										<option value="America/Manaus">Manaus (GMT-4)</option>
										<option value="America/Rio_Branco">Rio Branco (GMT-5)</option>
										<option value="America/Noronha">Fernando de Noronha (GMT-2)</option>
									</select>
								</label>
								<div className="full-span">
									<Toggle
										id="platform-notifications"
										title="Notificações da plataforma"
										description="Receber alertas importantes da operação."
										checked={draft.notifications.platform}
										onChange={(value) => update('notifications', 'platform', value)}
									/>
								</div>
							</div>
							<SaveActions feedback={feedback} />
						</form>
					)}

					{tab === 'Notificações' && (
						<form onSubmit={save}>
							<div className="settings-fields settings-option-list">
								<Toggle
									id="message-sounds"
									title="Sons de mensagens"
									description="Permitir sons de alerta para novas mensagens."
									checked={draft.notifications.messageSounds}
									onChange={(value) => update('notifications', 'messageSounds', value)}
								/>
								<Toggle
									id="desktop-notifications"
									title="Notificações na área de trabalho"
									description="Permitir notificações do navegador quando disponíveis."
									checked={draft.notifications.desktop}
									onChange={(value) => update('notifications', 'desktop', value)}
								/>
								<Toggle
									id="message-preview"
									title="Pré-visualização de mensagens"
									description="Mostrar o conteúdo da mensagem nas notificações."
									checked={draft.notifications.preview}
									onChange={(value) => update('notifications', 'preview', value)}
								/>
							</div>
							<SaveActions feedback={feedback} />
						</form>
					)}

					{tab === 'Privacidade' && (
						<form onSubmit={save}>
							<div className="settings-fields">
								<Toggle
									id="read-receipts"
									title="Confirmações de leitura"
									description="Permitir o indicador de mensagens lidas (ticks azuis)."
									checked={draft.privacy.readReceipts}
									onChange={(value) => update('privacy', 'readReceipts', value)}
								/>
								<VisibilitySelect
									id="last-seen"
									label="Visto por último"
									value={draft.privacy.lastSeen}
									onChange={(value) => update('privacy', 'lastSeen', value)}
								/>
								<VisibilitySelect
									id="online-visibility"
									label="Status online"
									value={draft.privacy.online}
									onChange={(value) => update('privacy', 'online', value)}
								/>
								<VisibilitySelect
									id="profile-photo-visibility"
									label="Foto do perfil"
									value={draft.privacy.profilePhoto}
									onChange={(value) => update('privacy', 'profilePhoto', value)}
								/>
							</div>
							<SaveActions feedback={feedback} />
						</form>
					)}

					{tab === 'Conversas e aparência' && (
						<form onSubmit={save}>
							<div className="form-grid settings-fields">
								<label htmlFor="appearance-theme">
									Tema
									<select
										id="appearance-theme"
										value={draft.appearance.theme}
										onChange={(event) => update('appearance', 'theme', event.target.value)}
									>
										<option value="system">Usar configuração do sistema</option>
										<option value="light">Claro</option>
										<option value="dark">Escuro</option>
									</select>
								</label>
								<div className="full-span">
									<Toggle
										id="enter-to-send"
										title="Tecla Enter envia mensagem"
										description="Desativado: Enter insere uma nova linha; Ctrl+Enter envia."
										checked={draft.appearance.enterToSend}
										onChange={(value) => update('appearance', 'enterToSend', value)}
									/>
								</div>
							</div>
							<SaveActions feedback={feedback} />
						</form>
					)}

					{informationalSections[tab] && (
						<form onSubmit={save}>
							<div className="settings-info">
								<h4>{informationalSections[tab].title}</h4>
								<p>{informationalSections[tab].text}</p>
							</div>
							<SaveActions feedback={feedback} />
						</form>
					)}

					{tab === 'Ajuda e sobre' && (
						<form onSubmit={save}>
							<div className="settings-info">
								<h4>In a Blink</h4>
								<p>Central de atendimento para gerenciar conversas, contatos e relatórios.</p>
								<button className="secondary-button restore-button" type="button" onClick={reset}>
									<Check size={16} aria-hidden="true" />
									Restaurar configurações padrão
								</button>
							</div>
							<SaveActions feedback={feedback} />
						</form>
					)}
				</article>
			</div>
		</>
	);
}

function SaveActions({ feedback }) {
	return (
		<div className="settings-actions">
			<button className="primary" type="submit">Salvar alterações</button>
			{feedback.message && (
				<p className={`settings-feedback ${feedback.isError ? 'error' : ''}`} role={feedback.isError ? 'alert' : 'status'} aria-live="polite">
					{feedback.message}
				</p>
			)}
		</div>
	);
}

function VisibilitySelect({ id, label, value, onChange }) {
	return (
		<label className="visibility-select" htmlFor={id}>
			{label}
			<select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
				<option value="everyone">Todos</option>
				<option value="contacts">Meus contatos</option>
				<option value="nobody">Ninguém</option>
			</select>
		</label>
	);
}
