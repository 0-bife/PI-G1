// Logo reutilizado no login e na barra lateral.
import logo from "../assets/logo inb.png";

// Logo reutilizado no login e na barra lateral.
export default function Logo() {
  return (
    <div className="logo">
      <img className="logo-image" src={logo} alt="logo inb" />

      <div>
        <strong>in a blink</strong>
        {/* <small>Business Messaging</small> */}
      </div>
    </div>
  );
}
