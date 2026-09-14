export function PlaneStub() {
  return (
    <div className="stub">
      <p>
        Зараз на лінку <b>plane</b>. Карта контурів крила ще заглушка — її зберемо окремо.
      </p>
      <p>
        Далі тут буде не PSC+ATC, а <code>RLL_*</code> / <code>PTCH_*</code> (кут → rate → серво), зовні{" "}
        <code>NAVL1_*</code> і <code>TECS_*</code>. Yaw за замовчуванням <code>YAW2SRV_*</code>.
      </p>
    </div>
  );
}
