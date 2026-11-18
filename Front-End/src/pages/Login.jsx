import { useState } from 'react';
import { Clock, Eye, EyeOff, MessageCircle } from 'lucide-react';
import { login } from '../api.ts';
import Logo from '../components/Logo.jsx';

export default function Login({ onLogin, initialError = '' }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, senha);
      onLogin(result.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-panel">
        <Logo />

        <form className="login-copy" onSubmit={handleSubmit}>
          <span className="eyebrow">BEM-VINDO DE VOLTA</span>
          <h1>Atendimento que acontece <em>in a blink.</em></h1>
          <p>Centralize conversas, clientes e resultados em uma experiência simples.</p>

          <label>
            E-mail
            <input
              required
              type="email"
              autoComplete="username"
              placeholder="voce@empresa.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label>
            Senha
            <div className="password">
              <input
                required
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={senha}
                onChange={(event) => setSenha(event.target.value)}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          {error && <p className="api-error" role="alert">{error}</p>}

          <button className="primary login-button" type="submit" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>

          <p className="signup">
            Não tem acesso? Fale com o administrador da sua empresa.
          </p>
        </form>

        <small className="copyright">© 2026 in a blink. Todos os direitos reservados.</small>
      </section>

      <aside className="login-visual">
        <div className="visual-card vc1">
          <MessageCircle size={38} />
          <div>
            <b>+1.284</b>
            <span>mensagens hoje</span>
          </div>
        </div>

        <div className="visual-phone">
          <div className="phone-head">
            <div className="avatar">MS</div>
            <div>
              <b>Mariana Souza</b>
              <span>online</span>
            </div>
          </div>
          <div className="mini-msg left">Olá! Gostaria de conhecer os planos.</div>
          <div className="mini-msg right">Claro! Vou te ajudar 😊</div>
          <div className="mini-msg left">Perfeito, obrigada!</div>
        </div>

        <div className="visual-card vc2">
          <Clock />
          <div>
            <b>3m 42s</b>
            <span>tempo médio</span>
          </div>
        </div>

        <div className="visual-title">
          <span>CONVERSAS QUE FLUEM</span>
          <h2>Mais proximidade.<br />Menos complicação.</h2>
        </div>
      </aside>
    </div>
  );
}