import { useState } from 'react';
import { MessageCircle, Eye } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import { login } from '../api.ts';

export default function Login({ onLogin, initialError = '' }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
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
          <label>E-mail<input required type="email" placeholder="voce@empresa.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Senha<div className="password"><input required type="password" placeholder="••••••••" value={senha} onChange={(event) => setSenha(event.target.value)} /><Eye size={18} /></div></label>
          <div className="login-links"><label><input type="checkbox" /> Lembrar de mim</label><button type="button">Esqueci minha senha</button></div>
          {error && <p className="api-error" role="alert">{error}</p>}
          <button className="primary login-button" type="submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
          <p className="signup">Ainda não tem conta? <button type="button">Criar conta</button></p>
        </form>
        <small className="copyright">© 2026 in a blink. Todos os direitos reservados.</small>
      </section>
      <aside className="login-visual">
        <div className="visual-card vc1"><MessageCircle size={38} /></div>
        <div className="visual-title"><span>CONVERSAS QUE FLUEM</span><h2>Mais proximidade.<br />Menos complicação.</h2></div>
      </aside>
    </div>
  );
}
