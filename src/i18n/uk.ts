/** Ukrainian strings. Keys are the English source phrases. */
export const uk: Record<string, string> = {
  SITL: "SITL",
  board: "борт",
  Simulation: "симуляція",
  Reset: "скинути",
  Start: "старт",
  Wipe: "wipe",
  home: "дім",
  "SITL stopped": "SITL зупинено",
  "Downloading {file}": "завантаження {file}",
  "Starting {vehicle}…": "запуск {vehicle}…",
  "Running {vehicle} · tcp 5770": "працює {vehicle} · tcp 5770",
  "Waiting for HEARTBEAT on 5770": "чекаємо HEARTBEAT на 5770",
  "{cpu}% · {ram} MB": "{cpu}% · {ram} МБ",
  "SITL error: {err}": "помилка SITL: {err}",
  "Restore simulation defaults": "Повернути типові симуляції",
  "Recent links": "останні лінки",
  Wind: "вітер",
  GPS: "GPS",
  Compass: "компас",
  IMU: "IMU",
  Battery: "батарея",
  Baro: "баро",
  RC: "RC",
  Motors: "мотори",
  speed: "швидкість",
  direction: "напрям",
  turbulence: "турбулентність",
  vertical: "вертикаль",
  settle: "інерція",
  speedup: "прискорення",
  "GPS on": "GPS увімк",
  "GPS fail": "відмова GPS",
  satellites: "супутники",
  lag: "лаг",
  jam: "глушіння",
  "glitch N": "збій N",
  "RC fail": "відмова RC",
  "no RC": "немає RC",
  "thr fail": "газ fail",
  "motor {n}": "мотор {n}",
  "thrust left": "тяги лишилось",
  vibe: "вібрація",
  "motor vibe": "вібро моторів",
  "accel fail": "відмова accel",
  drift: "дрейф",
  noise: "шум",
  delay: "затримка",
  "mag fail": "відмова mag",
  disable: "вимкнути",
  freeze: "заморозка",
  glitch: "збій",
  voltage: "напруга",
  capacity: "ємність",
  on: "on",

  Options: "Опції",
  Close: "Закрити",
  Language: "Мова",
  Init: "Ініт",
  Export: "Експорт",
  "Init · {vehicle}": "Ініт · {vehicle}",
  "Stock dump + lab. Writes the stand — arm-ready.":
    "Сток-дамп + лаба. Запис стенда — готовий до arm.",
  "Write live parameters to a .parm file.":
    "Записати живі параметри у файл .parm.",
  "Write the lab stand dump so a blank board can arm.":
    "Залити стендовий дамп, щоб голий борт можна було армити.",
  "Export current parameters as a .parm file":
    "Експортувати поточні параметри у файл .parm",
  MCP: "MCP",
  Copy: "Копіювати",
  Copied: "Скопійовано",
  "Cursor uses the same MAVLink as this window. Start ArduLoops, then paste the config.":
    "Cursor ходить тим самим MAVLink, що й це вікно. Запустіть ArduLoops, потім вставте конфіг.",
  "Copy Cursor MCP config": "Копіювати MCP-конфіг для Cursor",

  Link: "лінк",
  Stop: "стоп",
  Disconnect: "Від’єднати",
  "Plots paused": "графіки на паузі",
  "Plots running": "графіки далі",
  "Link {url}": "лінк {url}",
  "Link off": "лінк вимкнено",
  "Init · disarm first": "ініт · спочатку disarm",
  "Init · {n} parameters · {vehicle}": "ініт · {n} параметрів · {vehicle}",
  "Init · {n} parameters · {vehicle} · reboot":
    "ініт · {n} параметрів · {vehicle} · ребут",
  "Init · {done}/{total}": "ініт · {done}/{total}",
  "Init · parameters have not arrived yet, wait": "ініт · параметри ще не прийшли, зачекайте",
  "Export · parameters have not arrived yet, wait": "експорт · параметри ще не прийшли, зачекайте",
  "Stand · wrote {n} of {total}": "стандарт · записано {n} з {total}",
  "Axis · {axis}": "вісь · {axis}",
  "Model · 3D": "модель · 3D",
  "Model · one axis": "модель · одна вісь",

  "We want an angle. We don't command the angle — we command the rate that takes us there.":
    "Хочемо кут. Керуємо не кутом, а швидкістю, якою туди крутимось.",
  "The wing layers view is still a stub. RLL_ / PTCH_ / L1 / TECS will appear later.":
    "Шари крила ще заглушка. RLL_ / PTCH_ / L1 / TECS з’являться пізніше.",
  "Link is up, but attitude is not arriving (ATT 0 Hz). The plot stays flat until ATTITUDE arrives.":
    "Лінк є, але кут не надходить (ATT 0 Hz). Графік плоский, поки не прийде ATTITUDE.",
  "No MAVLink: {detail}. Check the address and the vehicle.":
    "Немає MAVLink: {detail}. Перевірте адресу й борт.",
  View: "вид",
  "Show {frame}": "Показати {frame}",
  Plot: "графік",
  Layers: "шари",
  Loop: "контур",
  "L1 · track → bank": "L1 · трек → крен",
  "Not AC_PID. Cross-track error becomes a demanded bank for the roll loop. Period smaller = tighter turn.":
    "Не AC_PID. Помилка треку стає замовленим креном для roll-контуру. Менший period — тугіший розворот.",
  "cross-track": "зліт з лінії",
  "not on this MAVLink sample": "немає на цьому MAVLink-зразку",
  "roll loop": "контур крену",
  "Looks a distance L1 ahead, asks for lateral accel, then bank via atan(a/g). Period smaller = tighter.":
    "Дивиться на відстань L1 уперед, просить бічне прискорення, потім крен через atan(a/g). Менший period — тугіший.",
  groundspeed: "шляхова швидкість",
  "to L1 point": "на точку L1",
  "(1/pi)·DAMP·PERIOD·V": "(1/pi)·DAMP·PERIOD·V",
  "lateral accel": "бічне accel",
  "K · V² / L1 · sin(Nu)": "K · V² / L1 · sin(Nu)",
  "4 · DAMP²": "4 · DAMP²",
  "TECS · energy → pitch + throttle": "TECS · енергія → тангаж + газ",
  "Not a height PID. One energy, two plants. SPDWEIGHT: 0 height, 2 speed, 1 both.":
    "Не PID висоти. Одна енергія, два plant. SPDWEIGHT: 0 висота, 2 швидкість, 1 обидва.",
  "height error": "помилка висоти",
  "pitch loop": "контур тангажу",
  "engine / air": "двигун / повітря",
  "Pick a block — extra knobs sit under the scheme.": "Клікніть блок — додаткові крутилки під схемою.",
  "This block has no extra knobs.": "На цьому блоці немає додаткових крутилок.",
  tuning: "тюнінг",
  "without knobs": "без крутилок",
  "Throttle holds total energy. Pitch only trades height for speed. W is the mix, not a P.":
    "Газ тримає повну енергію. Тангаж лише міняє висоту на швидкість. W — суміш, не P.",
  "V* not on this MAVLink sample": "V* немає на цьому MAVLink-зразку",
  "g · height": "g · висота",
  "½ V²": "½ V²",
  "total → throttle": "повна → газ",
  "W mix → pitch": "суміш W → тангаж",
  "0 height on pitch · 2 speed on pitch": "0 висота на тангажі · 2 швидкість на тангажі",
  Wiki: "Wiki",
  "TECS speed/height": "TECS швидкість/висота",
  "The L1 controller looks a distance L1 ahead of the track and asks for a lateral acceleration, then a bank φ* = atan(a/g). That bank is nav_roll for the roll loop.":
    "L1 дивиться на відстань L1 уперед по треку і просить бічне прискорення, потім крен φ* = atan(a/g). Цей крен — nav_roll для контуру roll.",
  "L1 length is (1/π) · DAMPING · PERIOD · groundspeed, so the tracking loop keeps a constant period as speed changes. NAVL1_PERIOD is the main knob (wiki default around 17–20): smaller is a tighter turn. NAVL1_DAMPING adds extra damping for GPS lag and roll delay — unlikely you need it below 0.6.":
    "Довжина L1 = (1/π) · DAMPING · PERIOD · шляхова швидкість, тож період треку сталий при зміні швидкості. NAVL1_PERIOD — головна крутилка (wiki ~17–20): менше — тугіший розворот. NAVL1_DAMPING додає демпфер на лаг GPS і затримку крену — нижче 0.6 майже не треба.",
  "Wiki: tune roll and pitch first, and set ROLL_LIMIT_DEG so the wing can hold the bank without stalling. Turns too slow: lower PERIOD by about 5. Weaving after a turn: raise PERIOD by 1–2. WP_RADIUS chooses fly-through vs turn-early.":
    "Wiki: спочатку roll і pitch, і ROLL_LIMIT_DEG такий, щоб крило тримало крен без звалювання. Повільний розворот — PERIOD мінус ~5. Виляння після розвороту — PERIOD плюс 1–2. WP_RADIUS: проліт точки чи ранній розворот.",
  "Cross-track error to the line. L1 uses it with Nu (the angle to the L1 point). This MAVLink sample does not carry the error itself — you see the bank that came out.":
    "Помилка поперек лінії. L1 бере її разом із Nu (кут на точку L1). На цьому MAVLink-зразку самої помилки немає — видно крен, який вийшов.",
  "Groundspeed. L1 length grows with V so the same PERIOD feels the same at different speeds. Wiki: a complementary filter fuses GPS velocity, airspeed and heading so GPS lag does not dominate.":
    "Шляхова швидкість. Довжина L1 росте з V, тож той самий PERIOD відчувається однаково на різних швидкостях. Wiki: complementary filter зливає GPS-швидкість, airspeed і heading, щоб лаг GPS не керував.",
  "Nu is the angle from the velocity vector to the L1 point. Lateral acceleration is K · V² / L1 · sin(Nu). Not on this MAVLink sample.":
    "Nu — кут від вектора швидкості до точки L1. Бічне прискорення: K · V² / L1 · sin(Nu). Немає на цьому MAVLink-зразку.",
  "L1 distance = (1/π) · DAMPING · PERIOD · groundspeed. The aircraft aims that far ahead on the track. The turn onto the next leg starts at this length, but never farther than WP_RADIUS.":
    "Відстань L1 = (1/π) · DAMPING · PERIOD · шляхова швидкість. Апарат цілиться так далеко вперед по треку. Розворот на наступну ногу починається на цій довжині, але не далі за WP_RADIUS.",
  "NAVL1_PERIOD. The time the guidance loop is tuned for. Smaller = sharper corners. Wiki start: 17, damping 0.75. If it weaves after a turn, add 1–2 s. If the turn is too slow, subtract about 5.":
    "NAVL1_PERIOD. Час, під який налаштований guidance. Менше — гостріші кути. Wiki старт: 17, damping 0.75. Виляння після розвороту — плюс 1–2 с. Занадто повільний розворот — мінус ~5.",
  "Guidance gain K = 4 · DAMPING² (instead of a fixed 2). Extra NAVL1_DAMPING covers GPS lag and roll delay. After PERIOD is set, you may step DAMPING by 0.05. Unlikely you need it below 0.6.":
    "Коефіцієнт K = 4 · DAMPING² (замість фіксованої 2). Запас NAVL1_DAMPING криє лаг GPS і затримку крену. Після PERIOD можна крокувати DAMPING по 0.05. Нижче 0.6 майже не треба.",
  "Demanded lateral acceleration a = K · V² / L1 · sin(Nu). Bank is atan(a/g). This sample does not carry a_y; nav_roll is what we see.":
    "Задане бічне прискорення a = K · V² / L1 · sin(Nu). Крен = atan(a/g). На цьому зразку a_y немає — видно nav_roll.",
  "nav_roll — the bank L1 asked for. Set ROLL_LIMIT_DEG to a bank the wing can hold without stalling (wiki: about 50° for a slow glider, about 65° for a fast aerobatic).":
    "nav_roll — крен, який попросив L1. ROLL_LIMIT_DEG — крен, який крило тримає без звалювання (wiki: ~50° повільний глайдер, ~65° швидка акробатика).",
  "The roll loop. Wiki: tune roll and pitch, and trim so the plane does not lose height in a turn, before L1. Raising PERIOD will not hold a wing that cannot hold bank.":
    "Контур крену. Wiki: спочатку roll і pitch, і трим щоб у розвороті не падала висота, потім L1. Більший PERIOD не втримає крило, яке не тримає крен.",
  "TECS (Total Energy Control System) coordinates throttle and pitch to hold height and airspeed. The aircraft has two mechanical energies: gravitational potential (mass × g × height) and kinetic (½ × mass × speed²). Drag always takes energy; only thrust or a thermal puts it back.":
    "TECS (Total Energy Control System) узгоджує газ і тангаж, щоб тримати висоту й повітряну швидкість. У апарата дві механічні енергії: потенціальна (маса × g × висота) і кінетична (½ × маса × швидкість²). Опір завжди забирає енергію; повертає лише тяга або термік.",
  "Total energy is their sum. TECS sets throttle to hold that total. Pitch does not add energy — it trades height for speed. If you are high and slow, total energy can still be right: too much potential, not enough kinetic. Lower the nose to move energy into speed.":
    "Повна енергія — їхня сума. TECS ставить газ, щоб тримати цю суму. Тангаж енергії не додає — міняє висоту на швидкість. Якщо високо й повільно, повна енергія може бути правильною: забагато потенціалу, замало кінетики. Опустити ніс — перелити енергію в швидкість.",
  "W (TECS_SPDWEIGHT) sits at the four-arrow crossing. It is how much pitch listens to speed vs height: 0 height, 1 both (stock), 2 speed (glider). STE does not use W. TECS_TIME_CONST is how quickly the energy error is chased — time, not a mix.":
    "W (TECS_SPDWEIGHT) стоїть на перехресті чотирьох стрілок. Скільки тангаж слухає швидкість проти висоти: 0 висота, 1 обидва (сток), 2 швидкість (глайдер). STE від W не залежить. TECS_TIME_CONST — як швидко ловити помилку енергії: час, не суміш.",
  "Wiki: tune the pitch-to-servo loop in FBWA first. If height then oscillates, raise TECS_TIME_CONST (do not go past 10). TECS is live in AUTO / FBWB / CRUISE / RTL / LOITER, not FBWA or MANUAL.":
    "Wiki: спочатку контур тангаж→серво в FBWA. Якщо висота потім осцилює — піднімайте TECS_TIME_CONST (не вище 10). TECS живий в AUTO / FBWB / CRUISE / RTL / LOITER, не в FBWA і не в MANUAL.",
  "Height error becomes gravitational potential energy. TECS_CLMB_MAX is the best climb at THR_MAX and AIRSPEED_CRUISE. TECS_SINK_MIN / SINK_MAX are idle glide and the steepest safe descent. Measure them in FBWA; if they are optimistic, height will oscillate.":
    "Помилка висоти стає потенціальною енергією. TECS_CLMB_MAX — найкращий набір на THR_MAX і AIRSPEED_CRUISE. TECS_SINK_MIN / SINK_MAX — планерний стік і найкрутіше безпечне зниження. Міряйте в FBWA; якщо оптимістичні — висота осцилюватиме.",
  "Airspeed is kinetic energy. AIRSPEED_MIN is the slowest safe speed in a bank. AIRSPEED_MAX is just under level-flight top with THR_MAX. AIRSPEED_CRUISE is where you took the climb/sink measurements. Without an airspeed estimate, SPDWEIGHT is forced to 0 (pitch holds height).":
    "Повітряна швидкість — кінетична енергія. AIRSPEED_MIN — найповільніша безпечна швидкість у крені. AIRSPEED_MAX — трохи нижче стелі горизонтального польоту на THR_MAX. AIRSPEED_CRUISE — де міряли climb/sink. Без оцінки airspeed SPDWEIGHT примусово 0 (тангаж тримає висоту).",
  "Gravitational potential energy = mass × gravity × height. Raising height costs energy; falling releases it. The stand shows g · h (energy per unit mass). This feeds both STE (throttle) and, through W, SEB (pitch).":
    "Потенціальна енергія = маса × g × висота. Підняти висоту коштує енергії; падіння її віддає. Стенд показує g · h (на одиницю маси). Це йде і в STE (газ), і через W в SEB (тангаж).",
  "Kinetic energy = ½ × mass × speed². Speeding up costs energy even at the same height. The stand shows ½ · V². This also feeds STE and, through W, SEB.":
    "Кінетична енергія = ½ × маса × швидкість². Розгін коштує енергії навіть на тій самій висоті. Стенд показує ½ · V². Це теж іде в STE і через W в SEB.",
  "TECS_SPDWEIGHT: how much the pitch loop weights speed vs height errors. 0.0: pitch holds height and ignores speed. 2.0: pitch holds speed and ignores height (glider / soaring). 1.0: both. It is not a P. STE is always SPE + SKE. No effect without an airspeed estimate.":
    "TECS_SPDWEIGHT: скільки контур тангажу важить помилки швидкості проти висоти. 0.0: тангаж тримає висоту і ігнорує швидкість. 2.0: тангаж тримає швидкість і ігнорує висоту (глайдер / soaring). 1.0: обидва. Це не P. STE завжди SPE + SKE. Без оцінки airspeed ефекту немає.",
  "The circle sits where the four arrows meet: height and speed each feed total energy and energy balance. Straight paths are each channel into itself; the diagonals are the cross.":
    "Кружок стоїть там, де зустрічаються чотири стрілки: висота й швидкість кожна годує і повну енергію, і баланс. Прямі — канал сам у себе; діагоналі — перехрес.",
  "Total energy = potential + kinetic. Throttle holds this total. More throttle: both higher and faster. TECS_TIME_CONST is the time constant of that chase (smaller = faster). TECS_THR_DAMP damps speed/height oscillation; TECS_INTEG_GAIN trims leftover error.":
    "Повна енергія = потенціал + кінетика. Газ тримає цю суму. Більше газу — і вище, і швидше. TECS_TIME_CONST — стала часу цієї погоні (менше = швидше). TECS_THR_DAMP гасить осциляцію швидкості/висоти; TECS_INTEG_GAIN зрізає залишок.",
  "Energy balance. Pitch moves energy between height and speed. Lower the nose: potential → kinetic. W sets how much of that job pitch takes versus throttle. TECS_PTCH_DAMP damps height oscillation after the pitch-to-servo loop is already tuned.":
    "Баланс енергії. Тангаж переливає енергію між висотою й швидкістю. Ніс униз: потенціал → кінетика. W каже, скільки цієї роботи бере тангаж, а скільки газ. TECS_PTCH_DAMP гасить осциляцію висоти, коли контур тангаж→серво вже налаштований.",
  "Throttle demand. THR_MAX must climb at PTCH_LIM_MAX_DEG at AIRSPEED_CRUISE. TRIM_THROTTLE is level flight at cruise. TECS_RLL2THR adds throttle in a bank for extra drag. Throttle cannot set the balance — that is pitch.":
    "Завдання газу. THR_MAX має набирати на PTCH_LIM_MAX_DEG при AIRSPEED_CRUISE. TRIM_THROTTLE — горизонт на круїзі. TECS_RLL2THR додає газ у крені на зайвий опір. Газ баланс не ставить — це тангаж.",
  "Pitch demand from the energy balance, clipped by PTCH_LIM_MAX_DEG / MIN. This is nav_pitch for the pitch loop, not the rate loop itself. TECS writes it in AUTO / FBWB / CRUISE / RTL / LOITER.":
    "Завдання тангажу з балансу енергії, обрізане PTCH_LIM_MAX_DEG / MIN. Це nav_pitch для контуру тангажу, не сам rate. TECS пише його в AUTO / FBWB / CRUISE / RTL / LOITER.",
  "The wing and the engine. Drag constantly reduces total energy. Only thrust (or a thermal) puts it back. Nose up: height grows, speed falls — the plant cannot add height without losing speed.":
    "Крило і двигун. Опір постійно з’їдає повну енергію. Повертає лише тяга (або термік). Ніс угору: висота росте, швидкість падає — plant не додає висоти, не віддавши швидкість.",
  "The pitch-to-servo loop (PTCH_RATE). Wiki: TECS is only as good as this loop. Tune it in FBWA with AUTOTUNE or the pitch-rate knobs before touching TECS_TIME_CONST.":
    "Контур тангаж→серво (PTCH_RATE). Wiki: TECS рівно такий, як цей контур. Налаштуйте в FBWA через AUTOTUNE або крутилки pitch-rate, перш ніж чіпати TECS_TIME_CONST.",

  "No link": "Немає лінку",
  Disconnected: "Відключено",
  "Link dropped": "Лінк обірвався",
  "Rebooting…": "Ребут…",
  "No MAVLink ({url})": "Немає MAVLink ({url})",
  "No ATTITUDE, reconnect": "Немає ATTITUDE, reconnect",
  "No HEARTBEAT on {url}. Close the other GCS, or if the vehicle listens try udpout:host:port.":
    "Немає HEARTBEAT на {url}. Закрийте інший GCS, або якщо борт слухає — udpout:host:port.",
  "UDP port in use ({url}). Close Mission Planner / QGC.":
    "Порт зайнятий ({url}). Закрийте Mission Planner / QGC.",
  "Waiting for HEARTBEAT on {url}…": "Чекаємо HEARTBEAT на {url}…",

  copter: "коптер",
  plane: "крило",
  Home: "додому",
  Idle: "стоп",
  "Idle · this frame is not on the link": "Стоп · цієї рами немає на лінку",
  "No copter on this link. Grey until HEARTBEAT says copter.":
    "Немає коптера на цьому лінку. Сірий, поки HEARTBEAT не скаже copter.",
  "No plane on this link. Grey until HEARTBEAT says plane.":
    "Немає крила на цьому лінку. Сіре, поки HEARTBEAT не скаже plane.",

  roll: "крен",
  pitch: "тангаж",
  yaw: "рискання",
  D: "D",
  height: "висота",
  Height: "Висота",
  Roll: "Крен",
  Pitch: "Тангаж",
  Yaw: "Рискання",
  "Roll rate": "Швидкість крену",
  "Pitch rate": "Швидкість тангажа",
  "Yaw rate": "Швидкість рискання",
  climb: "climb",
  "climb Act": "climb Act",
  "climb target": "ціль climb",
  "altitude target": "ціль висоти",
  "accel target": "ціль accel",
  "accel Act": "accel Act",
  "NE target": "ціль NE",
  "NE pos": "NE pos",
  "speed target": "ціль швидкості",
  "NE vel": "NE vel",
  AGL: "AGL",
  "m/s": "м/с",
  "m/s²": "м/с²",
  Axis: "вісь",
  "Model: roll and pitch together": "Модель: крен і тангаж разом",
  "°/s": "°/с",

  Pause: "пауза",
  Resume: "далі",
  Space: "Пробіл",
  Watch: "блоки",
  "{n} blocks": "{n} блоки",
  "{n} blocks · {p} plots": "{n} блоки · {p} графіки",
  "same plot as {block}": "той самий графік, що {block}",
  "This plot is the live I/O of: {blocks}": "Цей графік — живий I/O блоків: {blocks}",
  "Blocks this mode closes": "Блоки, які цей режим замикає",
  "in / out of the selected card": "вхід / вихід вибраної картки",
  now: "зараз",
  "−{n} s": "−{n} с",

  "Where we want to be. Target is heading; actual should catch it. Yaw stick is rate, not angle — that is below.":
    "де хочемо бути. Ціль — курс; факт має її спіймати. Стік рискання — rate, не кут; він унизу.",
  "Heading, not the stick. Error is the shortest turn to the target.":
    "курс, не стік. Помилка — найкоротший поворот до цілі.",
  "Grey is the stick throw, 0 = centered. Yellow and cyan are heading.":
    "сірий — положення стика, 0 = центр. Жовта і блакитна — курс.",
  "Where we want to be. Target is not the stick — actual should catch the target.":
    "де хочемо бути. Ціль — не стік; факт має спіймати ціль.",
  Stick: "стик",
  Target: "ціль",
  Desired: "бажане",
  "error gap": "щілина",
  "FC target": "ціль",
  "Actual {name}": "{name} Act",
  "actual {ang}°   target {tar}°   stick {cmd}{unit}":
    "факт {ang}°   ціль {tar}°   стик {cmd}{unit}",
  "actual {ang}°   target {tar}°   error {err}°":
    "факт {ang}°   ціль {tar}°   помилка {err}°",
  "actual {ang}°   target {tar}°   stick {cmd}°   error {err}°":
    "факт {ang}°   ціль {tar}°   стик {cmd}°   помилка {err}°",
  "Stick here is rate, not angle. Target is the ATC rate command. In Stabilize the yaw stick goes here.":
    "стік тут — rate, не кут. Ціль — завдання rate від ATC. У Stabilize стік рискання йде сюди.",
  "Amber is the ATC yaw-rate command, cyan is the gyro. Left stick asks for rate — on the ground with throttle down the craft will not yaw.":
    "жовта — завдання yaw-rate від ATC, блакитна — гіроскоп. Лівий стік просить rate; на землі без газу апарат не розвернеться.",
  "How we get there. Rate command is not position — it is “rotate this fast”.":
    "чим туди їдемо. Завдання rate — не позиція, а «крутись ось так швидко».",
  "stick {cmd} °/s": "стик {cmd} °/с",

  "The link is {frame}. The wing layers map is still a stub — we will build it separately.":
    "Зараз на лінку {frame}. Карта шарів крила ще заглушка — її зберемо окремо.",
  "Here it will not be PSC+ATC, but RLL_* / PTCH_* (angle → rate → servo), with NAVL1_* and TECS_* outside. Yaw defaults to YAW2SRV_*.":
    "Далі тут буде не PSC+ATC, а RLL_* / PTCH_* (кут → rate → серво), зовні NAVL1_* і TECS_*. Yaw за замовчуванням YAW2SRV_*.",

  "On the ground": "на землі",
  "side view": "вид збоку",
  "top view": "вид зверху",
  "rear view": "вид ззаду",
  "Drag to orbit. Buttons snap the view.": "Тягни щоб крутити. Кнопки вирівнюють вид.",
  m: "м",

  "Earth, horizon: North and East. Metres and m/s. Not the nose of the drone.":
    "Земля, горизонт: North і East. Метри і м/с. Не ніс дрона.",
  "D+ is down. Height on the right is AGL, i.e. −D. m, m/s, m/s².":
    "D+ вниз. «Висота» справа — AGL, тобто −D. м, м/с, м/с².",
  "NE acceleration becomes lean — roll and pitch in degrees.":
    "Прискорення NE стає нахилом (lean) — крен і тангаж у градусах.",
  "Body attitude, degrees. Roll / pitch / yaw.":
    "Кут тіла (attitude), градуси. Roll / pitch / yaw.",
  "Body angular rate, °/s. Not airspeed m/s.":
    "Кутова швидкість (rate) тіла, °/с. Не м/с польоту.",
  "Motors: torque from rate and throttle from Down acceleration.":
    "Мотори: момент з кутової швидкості (rate) і газ з прискорення Down.",
  "NED on the earth. Angle and rate live in the drone body.":
    "NED на землі. Кут і кутова швидкість (rate) — у тілі дрона.",
  "top · NE": "згори · NE",
  "side · D+": "збоку · D+",
  "rear · body": "ззаду · тіло",
  "m · m/s": "м · м/с",
  "m · m/s · m/s²": "м · м/с · м/с²",
  "roll · pitch · yaw": "крен · тангаж · yaw",

  "Preset sets P I D. Throttle is left stick, roll is right.":
    "Пресет ставить P I D. Газ — лівий стик, крен — правий.",
  "No link · {detail}": "немає лінку · {detail}",
  "On the ground · AGL < 2 m, sticks barely rotate the craft":
    "на землі · AGL < 2 м, стики майже не крутять",
  "On the runway. MANUAL is the stick on the surface.":
    "На смузі. У MANUAL стик — це поверхня.",
  Airborne: "у повітрі",
  "The craft is sitting. Raise throttle — otherwise the stick will not move it.":
    "Апарат на землі. Підніміть газ — інакше стик не зрушить його.",
  Wool: "вата",
  Sharp: "гостро",
  "Harsh / ringing": "різкість / дзвін",
  Stock: "сток",
  Maneuver: "маневр",
  "Act lags Tar. P and I are small: there is error, little rate.":
    "Act відстає від Tar. P і I малі: помилка є, швидкості мало.",
  "Yaw P is small. Left stick — a slow turn.":
    "P рискання малий. Лівий стик — повільний розворот.",
  "P×0.2 and I are cut. Quiet in hover; {stick} stick — slow return (wool).":
    "P×0.2 і I зрізані. На висінні тихо; {stick} стиком — повільне повернення (вата).",
  "Act chases Tar. P is large — expect overshoot or ringing.":
    "Act ганяється за Tar. P великий — очікуйте переліт або дзвін.",
  "P is high. {Stick} stick will show overshoot or ringing.":
    "P завищений. {Stick} стиком покаже переліт або дзвін.",
  "Yaw stick is rate. Watch whether amber and cyan match on the lower plot.":
    "Стік рискання — це rate. Дивіться, чи жовта і синя на нижньому графіку збігаються.",
  "Watch whether cyan meets yellow after you release the stick.":
    "Дивіться, чи збігається блакитна лінія з жовтою після відпускання стика.",
  "Yaw is separate: I is smaller, D is often 0. Left stick is the reference — does rate catch the command.":
    "Yaw окремо: I менший, D часто 0. Лівий стік — еталон, чи rate ловить завдання.",
  "Typical P. {Stick} stick is the horizon-return reference.":
    "Типове P. {Stick} стиком — еталон повернення на горизонт.",
  "AGL height": "висота AGL",
  "takeoff ↑ {v} m/s": "зліт ↑ {v} м/с",
  Sitting: "лежить",
  "↑ {v} m/s": "↑ {v} м/с",
  "↓ {v} m/s": "↓ {v} м/с",
  Holding: "тримає",
  "Flight mode": "Режим польоту",
  Mode: "режим",
  "Mode {mode}": "режим {mode}",
  "Virtual Mode 2 sticks": "віртуальні стики Mode 2",
  "Left stick: yaw (left-right)": "Лівий стик: рискання (ліво-право)",
  "Left stick: throttle and yaw": "Лівий стик: газ і рискання",
  "Right stick: roll and pitch": "Правий стик: крен і тангаж",
  "Right stick: pitch (up-down)": "Правий стик: тангаж (вгору-вниз)",
  "Right stick: roll (left-right)": "Правий стик: крен (ліво-право)",
  Thr: "газ",
  "Thr−": "газ−",
  "Yaw−": "риск−",
  "Yaw+": "риск+",
  "Roll−": "крен−",
  "Roll+": "крен+",
  Log: "журнал",
  "No gains. Pick a regulator — sliders stay here and on the plot.":
    "Немає гейнів. Виберіть регулятор — слайдери залишаться тут і на графіку.",
  "Wool · P {p} I {i} D {d}": "вата · P {p} I {i} D {d}",
  "Stock · P {p} I {i} D {d} · TC {tc} ACC {acc} Rmax {rmax}":
    "сток · P {p} I {i} D {d} · TC {tc} ACC {acc} Rmax {rmax}",
  "Sharp · P {p} I {i} D {d}": "гостро · P {p} I {i} D {d}",
  "arm · {mode}": "arm · {mode}",
  "Arm / force disarm": "Arm / force disarm",
  off: "off",

  "lean angle": "нахил (lean)",
  "accel NE": "accel NE",
  "desired roll/pitch": "desired roll/pitch",
  "desired ad": "desired ad",
  "tar rate": "tar rate",
  "rate Act": "rate Act",
  nav_roll: "nav_roll",
  nav_pitch: "nav_pitch",
  achieved: "achieved",
  "{att} {ang}°   {nav} {tar}°   stick {cmd}°   V {v} m/s":
    "{att} {ang}°   {nav} {tar}°   стик {cmd}°   V {v} м/с",
  "achieved {act}°/s   desired {des}°/s": "achieved {act}°/с   desired {des}°/с",
  "Pilot stick": "стік пілота",
  Navigation: "навігація",
  "NE position": "позиція NE",
  "D position": "позиція D",
  "NE velocity": "швидкість NE",
  "D velocity": "швидкість D",
  "D acceleration": "прискорення D",
  "angle → rate": "кут → rate",
  "rate → torque": "rate → момент",
  command: "команда",
  "targets, not PID": "цілі, не PID",
  "not PID": "не PID",
  stick: "стік",
  "m · NED": "м · NED",
  "m · NED NE": "м · NED NE",
  "m · NED D+": "м · NED D+",
  "m/s · NED NE": "м/с · NED NE",
  "m/s · NED D+": "м/с · NED D+",
  "° · roll/pitch": "° · крен/тангаж",
  "m/s² · throttle": "м/с² · газ",
  "° · body": "° · тіло",
  "°/s · body": "°/с · тіло",
  "torque + throttle": "момент + газ",
  "accel → roll/pitch": "accel → крен/тангаж",
  typical: "типово",
  "Not a loop — the stick request. Stabilize wants an angle, AltHold a climb rate (PILOT_SPD_UP / DN), Loiter a lean/accel, Acro a rate. TC / ACC / Rmax only shape how fast that request may change (Input Shaping).":
    "Не контур — запит зі стика. Stabilize хоче кут, AltHold — climb (PILOT_SPD_UP / DN), Loiter — lean/accel, Acro — rate. TC / ACC / Rmax лише обмежують, як швидко цей запит може змінюватись (Input Shaping).",
  "Do not raise ACC or Rmax past Autotune to “get more P”. That is feel, not stability. If AltHold creeps, hover is not mid-stick — set MOT_THST_HOVER, do not touch PSC yet.":
    "Не піднімай ACC чи Rmax вище Autotune, щоб «було більше P». Це відчуття, не стабільність. Якщо AltHold повзе — ховер не на середині стика: став MOT_THST_HOVER, не чіпай PSC.",
  "Writes a place for PSC to hold, plus how fast to get there. WP_SPD is mission cruise; LOIT_SPEED_MS is stick speed in Loiter. Not a PID.":
    "Пише місце, яке PSC має тримати, і як швидко туди летіти. WP_SPD — круїз місії; LOIT_SPEED_MS — швидкість зі стика в Loiter. Не PID.",
  "Drifting in Loiter is GPS, compass, vibe or PSC. These speeds only cap how fast it flies the path — raising them will not hold position.":
    "Дрейф у Loiter — GPS, компас, вібрації або PSC. Ці швидкості лише обмежують, як швидко летить шлях — підняти їх не утримає позицію.",
  "Holds North–East in metres: position error → desired horizontal speed. P only.":
    "Тримає North–East у метрах: помилка позиції → бажана горизонтальна швидкість. Лише P.",
  "Leave stock until attitude is tuned. Raising P will not fix a bad rate loop or a bad mag.":
    "Залиш сток, доки не налаштований attitude. Підняти P не виправить слабкий rate чи поганий маг.",
  "Holds height: AGL error (−D) → desired climb. P only. D+ is down.":
    "Тримає висоту: помилка AGL (−D) → бажаний climb. Лише P. D+ вниз.",
  "Too much P → jerky throttle. Switching into AltHold while climbing makes motors dip, then catch — enter while level.":
    "Занадто високий P → рваний газ. Вхід в AltHold під час набору садить мотори, потім ловить — заходь рівно.",
  "Turns “go there” into a lean request: speed error → desired NE acceleration. There is no separate horizontal accel PID.":
    "Перетворює «лети туди» на запит lean: помилка швидкості → бажане прискорення NE. Окремого горизонтального accel PID немає.",
  "If Loiter weaves after a good ATC tune, look here — not at Navigation. Too much D twitches the lean.":
    "Якщо Loiter плететься після нормального ATC — дивись сюди, не в Navigation. Занадто багато D смикає lean.",
  "Turns the climb command into vertical acceleration. Usually left at defaults.":
    "Перетворює команду climb на вертикальне прискорення. Зазвичай лишають сток.",
  "Do not chase bounce on this P. Check vibe and PSC_D_ACC I (keep P:I ≈ 1:2) first.":
    "Не ганяй підскоки цим P. Спочатку вібрації і PSC_D_ACC I (тримай P:I ≈ 1:2).",
  "Geometry, not a loop: NE acceleration (earth, m/s²) becomes roll/pitch (body, °). ATC_ANGLE_MAX is the lean ceiling.":
    "Геометрія, не контур: прискорення NE (земля, м/с²) стає креном/тангажем (тіло, °). ATC_ANGLE_MAX — стеля нахилу.",
  "Not Loiter speed — that is LOIT_SPEED_MS on Navigation. Raising ANGLE_MAX only lets it tilt more. Wrong lean still usually means velocity PID or ATC.":
    "Це не Loiter speed — він на Navigation (LOIT_SPEED_MS). Підняти ANGLE_MAX лише дозволяє сильніше нахилятись. Кривий lean усе одно частіше velocity PID або ATC.",
  "Throttle from vertical accel error. Skips the angle loop — motors get force, not a tilt.":
    "Газ з помилки вертикального accel. Минає контур кута — мотори отримують силу, не нахил.",
  "Never raise P/I; powerful frames may cut both ~50%. Keep I ≈ 2×P. I = 0 fails pre-arm. High vibe → runaway climb in AltHold.":
    "Ніколи не піднімай P/I; потужні рами можуть обрізати обидва ~50%. Тримай I ≈ 2×P. I = 0 валить pre-arm. Сильні вібрації → розгін вгору в AltHold.",
  "Angle error → how fast to rotate (rate command). P only. Motors cannot “be 10°”.":
    "Помилка кута → як швидко крутитись (команда rate). Лише P. Мотори не вміють «бути 10°».",
  "High P → oscillate; low P → sluggish. Do not crank ANG P to hide a weak rate tune. Autotune sets this after rate.":
    "Високий P → осциляція; низький → мляво. Не крути ANG P, щоб сховати слабкий rate. Autotune ставить це після rate.",
  "The loop you actually fly: °/s error → mixer torque. Rate P is the first parameter that matters.":
    "Контур, яким реально літаєш: помилка °/с → момент у мікшер. Rate P — перший параметр, що має значення.",
  "Tune in Stabilize before Autotune. Oscillation → lower P/D, not more I. Fix gyro notch/vibe before chasing D. Yaw is separate (small I, D often 0).":
    "Налаштовуй у Stabilize до Autotune. Осциляція → знижуй P/D, не досипай I. Спершу notch/вібрації гіро, потім D. Yaw окремо (малий I, D часто 0).",
  "Mixer: rate torque plus D-accel throttle. Not a PID.":
    "Мікшер: момент з rate плюс газ з D-accel. Не PID.",
  "Hover should sit near mid stick (~50%). That is MOT_THST_HOVER below. Above ~70% the frame is underpowered — motors/props, not PIDs.":
    "Ховер має бути біля середини стика (~50%). Це MOT_THST_HOVER нижче. Вище ~70% рама слабка — мотори/пропи, не PID.",

  "want · angle, °": "хочемо · кут, °",
  "want · height, m": "хочемо · висота, м",
  "command · rate, °/s": "керуємо · rate, °/с",
  "command · climb, m/s": "керуємо · climb, м/с",
  "lean · roll / pitch, °": "крен · roll / pitch, °",
  "path · speed / height": "шлях · швидкість / висота",
  "throttle, %": "газ, %",
  "heading, °": "курс, °",
  "yaw rate, °/s": "yaw rate, °/с",
  "AHRS · roll / pitch, °": "AHRS · roll / pitch, °",
  "airspeed · throttle": "швидкість · газ",
  "This block has no live MAVLink trace on the stand yet.":
    "У цього блока ще немає живого MAVLink-сліду на стенді.",
  "N/E position is not on this MAVLink sample. Groundspeed and AGL are what we have.":
    "N/E на цьому MAVLink-семплі немає. Є groundspeed і AGL.",
  "Measured attitude. The yaw damper reads sin(this bank).":
    "Виміряна орієнтація. Демпфер рискання читає sin(цього крену).",
  "TECS airspeed setpoint is not on this MAVLink sample. Airspeed and throttle are the plants we can see.":
    "Уставка TECS по швидкості на цьому MAVLink-семплі немає. Швидкість і газ — те, що видно.",
  "Yellow is the altitude target, cyan is AGL (−D). Throttle stick is on the readout — 0 = mid.":
    "жовта — ціль висоти, блакитна — AGL (−D). Стік газу в рядку цифр, 0 = середина.",
  "AGL {ang} m   target {tar} m   throttle {cmd}%   error {err} m":
    "AGL {ang} м   ціль {tar} м   газ {cmd}%   помилка {err} м",
  "Amber is the throttle climb command (PILOT_SPD_UP), cyan is climb. Up is +.":
    "жовта — завдання climb зі стика газу (PILOT_SPD_UP), блакитна — climb. Вгору це +.",
  "tar climb": "tar climb",
  "climb {v} m/s   tar {tar} m/s": "climb {v} м/с   tar {tar} м/с",
  "climb {v} m/s": "climb {v} м/с",
  "{v} m/s": "{v} м/с",
  "{v}%": "{v}%",
  "Left stick: throttle (up-down)": "Лівий стик: газ (вгору-вниз)",
  "side view · height": "збоку · висота",
  Climb: "набір",
  "Throttle stick is climb. Amber on the lower plot should meet cyan.":
    "стік газу — це climb. Жовта на нижньому графіку має збігтися з блакитною.",
  "D+ is down. Height is AGL (−D). Left stick up/down is throttle.":
    "D+ вниз. Висота — AGL (−D). Лівий стик вгору-вниз — газ.",
  "want angle": "хочу кут",
  "stick = lean/accel": "стік = lean/accel",
  "stick = climb": "стік = climb",
  "stick = rate": "стік = rate",
  "XY target": "ціль XY",
  "D target": "ціль D",
  "desired Vxy": "бажана Vxy",
  "desired Vd": "бажаний Vd",
  throttle: "газ",
  torque: "момент",
  "not a regulator": "не регулятор",
  tune: "настройка",
  "tune · manuals": "настройка · мануал",
  sometimes: "іноді",
  "sometimes · Loiter": "іноді · Loiter",
  "The manuals tune attitude first: rate (Manual / QuikTune / AutoTune), then angle P, then stick feel (Input Shaping). PSC position loops are usually left at defaults.":
    "За мануалом спочатку attitude: rate (Manual / QuikTune / AutoTune), далі angle P, потім відчуття стика (Input Shaping). Контури PSC зазвичай лишають стоком.",
  "Autotune writes the same rate and angle blocks, from AltHold. If Loiter still weaves after that, NE velocity is the next knob — not Navigation.":
    "Autotune пише ті самі блоки rate і angle, з AltHold. Якщо Loiter після цього ще плететься — наступний важіль швидкість NE, не Navigation.",
  PosControl: "PosControl",
  Attitude: "Attitude",
  PSC: "PSC",
  ATC: "ATC",
  Loops: "контури",
  "Holds where to be: position → velocity → acceleration. North–East is metres on the earth; Down is height. Horizontal output is lean — there is no separate accel PID.":
    "Тримає де бути: позиція → швидкість → прискорення. North–East — метри на землі; Down — висота. Горизонтальний вихід — lean: окремого PID прискорення немає.",
  "Vertical skips Attitude: Down acceleration (PSC_D_ACC) goes straight to throttle. Navigation only writes targets for PSC; it is not a regulator.":
    "Вертикаль Attitude обходить: прискорення Down (PSC_D_ACC) одразу йде в газ. Navigation лише пише цілі для PSC, це не регулятор.",
  "Leave stock until attitude is tuned. Autotune does not write PSC. If Loiter still weaves, NE velocity is the next knob — not Navigation.":
    "Лишай сток, доки не налаштований attitude. Autotune PSC не пише. Якщо Loiter ще плететься — наступний важіль швидкість NE, не Navigation.",
  "Holds the angle. Motors cannot “be 10°” — only thrust. Angle error becomes a rate command; the rate loop turns °/s error into mixer torque.":
    "Тримає кут. Мотори не вміють «бути 10°» — лише тяга. Помилка кута стає командою rate; контур rate перетворює помилку °/с на момент у мікшер.",
  "Yaw is the same two loops. Vertical does not come here: D acceleration stays in PosControl and goes to throttle.":
    "Рискання (yaw) — ті самі два контури. Вертикаль сюди не заходить: прискорення D лишається в PosControl і йде в газ.",
  "Tune rate first (Manual / QuikTune / AutoTune), then angle P, then stick feel. Do not crank ANG P to hide a weak rate.":
    "Спочатку rate (Manual / QuikTune / AutoTune), далі angle P, потім відчуття стика. Не крути ANG P, щоб сховати слабкий rate.",
  position: "позиція",
  velocity: "швидкість",
  acceleration: "прискорення",
  angle: "кут",
  actuator: "актуатор",
  "boundary · lean becomes desired angle": "межа · lean стає бажаним кутом",
  "stick {v}{unit}": "стик {v}{unit}",
  "target {v}°": "ціль {v}°",
  "{name} {v}°": "{name} {v}°",
  "tar {v}°/s": "tar {v}°/с",
  "rate {v}°/s": "rate {v}°/с",
  "AGL {v} m": "AGL {v} м",
  "{v}{unit}": "{v}{unit}",
  rate: "rate",
  "angular rate (rate)": "кутова швидкість (rate)",
  P: "P",
  "P only": "лише P",
  AC_PID: "AC_PID",
  AC_PID_2D: "AC_PID_2D",
  AC_PID_Basic: "AC_PID_Basic",
  "PWM / DShot": "PWM / DShot",
  "{v} °/s": "{v} °/с",
  "{v} m": "{v} м",
  "Why the loops are separate": "Чому контури окремі",
  "all loops": "усі контури",
  "In {mode} this loop is not running: the autopilot is not turning it. You can inspect gains, but they will not change behaviour until the mode closes the loop.":
    "У {mode} цей контур не працює: автопілот його зараз не крутить. Гейни можна дивитись, але на поведінку вони не вплинуть, поки режим його не замкне.",
  In: "Входить",
  Out: "Віддає",
  "Stock Copter layers: PosControl (PSC) holds where to be, Attitude Control (ATC) holds the angle.":
    "Штатні шари Copter: PosControl (PSC) тримає де бути, Attitude Control (ATC) тримає кут.",
  "Motors cannot “turn to 10°” — only thrust. Thrust difference makes torque. So the attitude regulator (ATC_ANG) does not spin motors: from angle error it computes how fast to rotate toward the target and sets a rate command for the next loop. The rate regulator does that job: °/s error → mixer torque.":
    "Мотори не вміють «повернутись на 10°» — лише тяга. Різниця тяг дає момент (torque). Тому регулятор кута (attitude, ATC_ANG) не крутить мотори: з помилки кута він рахує, як швидко треба крутитись до цілі, і ставить завдання кутової швидкості (rate, ATC_RAT) наступному контуру. Регулятор rate це завдання виконує: помилка °/с → момент у мікшер.",
  "The boundary is lean: horizontal acceleration becomes desired roll and pitch. Then ATC works in the body (° and °/s). Vertical skips angle: Down acceleration (PSC_D_ACC) goes straight to throttle. Yaw is the same two inner loops: angle and rate.":
    "Межа між ними — нахил (lean): горизонтальне прискорення стає бажаним креном і тангажем. Далі ATC працює в тілі (° і °/с). Вертикаль кут обходить: прискорення Down (accel, PSC_D_ACC) одразу йде в газ. Рискання (yaw) — ті самі два внутрішні контури: кут і кутова швидкість.",
  "There is no separate horizontal-acceleration PID. WP, Loiter and Circle set targets; they are not regulators. Not shown: Plane, CC2_, FHLD, FOLL, heli.":
    "Окремого PID горизонтального прискорення немає. WP, Loiter і Circle задають цілі, це не регулятори. Не показано: Plane, CC2_, FHLD, FOLL, heli.",
  "In {mode}, inactive blocks are not closed now.":
    "У {mode} неактивні блоки зараз не замкнені.",
  "All stock layers are visible now.": "Зараз видно всі штатні шари.",
  "this mode": "цьому режимі",

  "A loop because the output is compared to the command again.":
    "Контур тому, що вихід знову порівнюють із завданням.",
  "This block is not a PID. Below is a closed regulator loop (the same one on the map with P / I / D). Pick angle → rate or rate → torque to see live numbers.":
    "Цей блок не PID. Нижче — як виглядає замкнений контур регулятора (той самий, що на карті з літерами P / I / D). Виберіть кут → rate або rate → момент, щоб побачити живі числа.",
  "Closed PID loop": "Замкнений контур PID",
  "feedback — that is why it is a loop": "зворотний звʼязок (feedback) — тому це loop",
  feedback: "зворотний звʼязок",
  want: "хочемо",
  error: "помилка",
  plant: "обʼєкт",
  "plant · motors / body": "plant · мотори / тіло",
  "plant · servo / air": "plant · серво / повітря",
  "(−1…+1 mixer)": "(−1…+1 мікшер)",
  "(−1…+1 servo)": "(−1…+1 серво)",
  "FF is the lead into the servo. P/I/D trim the error. Same FF at two speeds is a different plant because authority grows with airspeed² around SCALING_SPEED.":
    "FF — випередження в серво. P/I/D дорізають помилку. Той самий FF на двох швидкостях — різна рослина, бо влада росте з airspeed² навколо SCALING_SPEED.",
  "RLL reads sin(this bank)": "RLL читає sin(цього крену)",
  actual: "факт",
  none: "немає",
  "rate command": "завдання rate",
  "actual rate": "факт rate",
  "angle target": "ціль кута",
  "desired rate": "бажаний rate",
  setpoint: "завдання",
  output: "вихід",
  "now {v}{mix}": "зараз {v}{mix}",
  "stick on the plot": "стік на графіку",
  "This is a simplification of AC_PID / AC_P. Firmware also has target and D filters (FLTT / FLTE / FLTD), integrator ceiling IMAX and slew limits (SMAX). On the wing, FF · r is added.":
    "Це спрощення AC_PID / AC_P. У прошивці ще фільтри цілі й D (FLTT / FLTE / FLTD), стеля інтегратора IMAX і обмеження slew (SMAX). На крилі додається FF · r.",
  extend: "ширше",
  "AC_PID filters are the dashed boxes. Gyro notch is on the cyan return (IMU), before the rate the PID subtracts. FREQ from hover FFT — not a feel slider.":
    "Пунктир — фільтри AC_PID. Виріз гіроскопа на ціановому поверненні (IMU), до rate, який PID віднімає. FREQ з FFT у зависанні — не слайдер «на відчуття».",
  "This stage is P only. Gyro notch is still on the IMU return.":
    "Тут лише P. Виріз гіроскопа все одно на поверненні IMU.",
  "gyro notch": "виріз гіро",
  "gyro IMU": "гіро IMU",
  PID: "ПІД",

  "A wing is not a copter. The same AC_PID sits on roll and pitch rate, but the plant is a servo whose authority grows with airspeed.":
    "Крило — не коптер. Той самий AC_PID на rate крену й тангажу, але рослина — серво, чия влада росте зі швидкістю.",
  "ACRO rate": "ACRO rate",
  "AC_PID + FF": "AC_PID + FF",
  "AGL {ang} m   throttle {cmd}%": "AGL {ang} м   газ {cmd}%",
  "AP_SteerController, not AC_PID. Live in every mode except MANUAL, only below GROUND_STEER_ALT.":
    "AP_SteerController, не AC_PID. Живий у всіх режимах крім MANUAL, лише нижче GROUND_STEER_ALT.",
  "AP_SteerController, not AC_PID. Live in every mode except MANUAL, only below GROUND_STEER_ALT. Open the Steer tab.":
    "AP_SteerController, не AC_PID. Живий у всіх режимах крім MANUAL, лише нижче GROUND_STEER_ALT. Відкрийте вкладку Steer.",
  "Amber is the rate command, cyan is the gyro. FF should make these overlap in FBWA.":
    "Жовта — завдання rate, блакитна — гіро. FF у FBWA має їх зблизити.",
  "FF should make these overlap in FBWA.":
    "FF у FBWA має їх зблизити.",
  "Angle error becomes a rate command (TCONST). The rate loop is AC_PID plus feedforward into aileron / elevator. Authority grows with airspeed.":
    "Помилка кута стає завданням rate (TCONST). Rate-контур — AC_PID плюс FF на елерон / руль висоти. Влада росте зі швидкістю.",
  "Body angular rate, °/s, into a servo. Airspeed scales how much that servo can do.":
    "Кутова швидкість тіла, °/с, у серво. Повітряна швидкість масштабує, скільки серво може зробити.",
  "Body attitude, degrees. Stick in FBWA is an angle, not a surface.":
    "Кут тіла, градуси. Стік у FBWA — це кут, не поверхня.",
  "Click Navigate or Attitude on the left of the map. Open Rate for the FF loop, Energy for TECS limits, Steer for the runway.":
    "Клацніть Navigate або Attitude зліва на карті. Rate — контур FF, Energy — межі TECS, Steer — смуга.",
  "Empty map shows every link this mode closes. Click a card for its in and out. Roll and pitch are two loops — not one block with an axis switch. Rate and Scope keep the axis buttons.":
    "Порожня карта — усі зв’язки, які цей режим замикає. Клік по картці — лише вхід і вихід. Крен і тангаж — два контури, не один блок з перемикачем осі. Rate і Scope лишають кнопки осі.",
  "Click a card. Roll and pitch are two loops — not one block with an axis switch. Rate and Scope keep the axis buttons.":
    "Клацніть картку. Roll і pitch — два контури, не один блок з перемикачем осі. Кнопки осі лишаються на Rate і Scope.",
  "Copying RLL_RATE_P onto pitch will porpoise. Independent writes. Same FF-first order.":
    "Копіювання RLL_RATE_P на тангаж дасть «дельфіна». Писати осі окремо. Той самий порядок: спочатку FF.",
  "Demand is not on this MAVLink stream — cyan is what the pitot / estimator reports.":
    "Завдання на цьому MAVLink-потоці немає — блакитна це те, що каже піто / оцінка.",
  "Do not crank TCONST down to hide a weak rate loop. Rate FF first.":
    "Не крутіть TCONST вниз, щоб сховати слабкий rate. Спочатку FF.",
  "Do not hunt a ‘height P’ here. If the nose porpoises, the pitch rate loop is still wrong — go back to Rate.":
    "Не шукайте тут «P висоти». Якщо ніс дельфінить — ще кривий pitch rate. Назад на Rate.",
  Energy: "енергія",
  FBWA: "FBWA",
  "Tune in FBWA": "тюніть у FBWA",
  "FBWA. Stick is an angle — FF, scaled by airspeed, moves the servo.":
    "FBWA. Стік — це кут. Серво рухає FF, масштабований швидкістю.",
  "FBWA angle": "кут FBWA",
  "FBWA stick is an angle. Yellow is the target — actual should catch it. Airspeed is the plant, not this plot.":
    "Стік FBWA — це кут. Жовта — ціль, факт має її спіймати. Повітряна швидкість — рослина, не цей графік.",
  "FBWA stick is an angle. Actual should catch the demand. Airspeed is the plant, not this plot.":
    "Стік FBWA — це кут. Факт має спіймати завдання. Повітряна швидкість — рослина, не цей графік.",
  "FBWA, not MANUAL. FF until amber and cyan match, then I = FF, then P, then D.":
    "FBWA, не MANUAL. FF, доки жовта й блакитна зійдуться, далі I = FF, потім P, потім D.",
  "FBWA, not MANUAL. Match FF to surface, set I = FF, then add P, then D. Do not copy pitch numbers onto roll.":
    "FBWA, не MANUAL. Підженіть FF під поверхню, I = FF, потім P, потім D. Не копіюйте числа тангажу на крен.",
  "Flying wings with no fuselage skip sideslip (SLIP). Tune KFF_RDDRMIX / DAMP before INT. Do not treat this as copter yaw P.":
    "Літаюче крило без фюзеляжу пропускає sideslip (SLIP). Спочатку KFF_RDDRMIX / DAMP, потім INT. Це не copter yaw P.",
  "Ground steer": "кермо на землі",
  "Ground steering below GROUND_STEER_ALT. Runway, not flight.":
    "Кермо на землі нижче GROUND_STEER_ALT. Смуга, не політ.",
  "Ground steering · STEER2SRV": "кермо на землі · STEER2SRV",
  "Horizontal navigation: cross-track error → desired bank for the roll loop. Period is the main knob — smaller is a tighter turn.":
    "Горизонтальна навігація: помилка треку → бажаний крен для roll-контуру. Period — головний важіль: менше = тісніший розворот.",
  "How fast demanded bank becomes a roll-rate command. If ANGLE_P is 0, P = 1/TCONST.":
    "Як швидко заданий крен стає завданням roll-rate. Якщо ANGLE_P = 0, P = 1/TCONST.",
  "If it is tame at cruise and wild in a dive, that is the scaler — not a new P. Do not retune FF after changing SCALING_SPEED without flying it again.":
    "Тихе на круїзі й дике в пікіруванні — це scaler, не нове P. Після зміни SCALING_SPEED не ставте FF наосліп без польоту.",
  "In MANUAL the ground steering loop is off — the stick is the wheel.":
    "У MANUAL кермо на землі вимкнене — стик і є колесо.",
  "Inner tuning in MANUAL does nothing — the autopilot is not in the loop. Switch to FBWA.":
    "Внутрішній тюнінг у MANUAL нічого не робить — автопілот не в контурі. Перемкніть на FBWA.",
  "L1 + TECS": "L1 + TECS",
  "L1 bank": "крен L1",
  "L1 looks at the track on the earth and asks for a bank. Not a roll PID.":
    "L1 дивиться трек на землі й просить крен. Це не roll PID.",
  "L1 track": "трек L1",
  Limits: "межі",
  MANUAL: "MANUAL",
  Map: "карта",
  "Mixer output. Roll/pitch authority is scaled by airspeed² around SCALING_SPEED. Same FF at two speeds is a different plant.":
    "Вихід мікшера. Влада крену/тангажу масштабується airspeed² навколо SCALING_SPEED. Той самий FF на двох швидкостях — різна рослина.",
  "Aileron, elevator, rudder (and nosewheel). Roll/pitch authority is scaled by airspeed² around SCALING_SPEED. Same FF at two speeds is a different plant.":
    "Елерон, руль висоти, руль напряму (і носове колесо). Влада крену/тангажу масштабується airspeed² навколо SCALING_SPEED. Той самий FF на двох швидкостях — різна рослина.",
  "Not AC_PID. DAMP on yaw rate, RLL to coordinate the turn.":
    "Не AC_PID. DAMP на yaw rate, RLL координує розворот.",
  "Not AC_PID. YAW2SRV_DAMP damps yaw rate; YAW2SRV_RLL coordinates the turn. YAW_RATE_* is ACRO-only and off by default.":
    "Не AC_PID. YAW2SRV_DAMP гасить yaw rate; YAW2SRV_RLL координує розворот. YAW_RATE_* лише ACRO і за замовчуванням вимкнений.",
  "Not PosControl. L1 turns cross-track error into a desired bank. TECS shares height and airspeed: pitch and throttle together, not a height PID.":
    "Не PosControl. L1 робить з помилки треку бажаний крен. TECS ділить висоту й швидкість: тангаж і газ разом, не PID висоти.",
  "Not a height PID. Pitch and throttle are two plants. SPDWEIGHT is the mix — 0 height, 2 speed, 1 both.":
    "Не PID висоти. Тангаж і газ — дві рослини. SPDWEIGHT — суміш: 0 висота, 2 швидкість, 1 обидва.",
  "Not a loop. In FBWA the stick asks for roll and pitch angle; throttle is still the left stick. In MANUAL the stick is the surface.":
    "Не контур. У FBWA стик просить кут крену й тангажу; газ лишається лівим стиком. У MANUAL стик і є поверхня.",
  "Outside attitude: L1 writes desired bank for the track; TECS shares height and airspeed into pitch and throttle. There is no copter PosControl (PSC_*) on a wing — that stack is QuadPlane Q_P, out of scope.":
    "Поза attitude: L1 пише бажаний крен для треку; TECS ділить висоту й швидкість на тангаж і газ. На крилі немає PosControl (PSC_*) — той стек у QuadPlane Q_P, поза стендом.",
  "P / TCONST": "P / TCONST",
  PWM: "PWM",
  "Pitch angle": "кут тангажу",
  "Plant is a servo, not motors. Same FF at two speeds is a different machine because authority grows with V².":
    "Рослина — серво, не мотори. Той самий FF на двох швидкостях — інша машина, бо влада росте з V².",
  "Porpoise in FBWA is usually PTCH_RATE, not TCONST. Check Rate before touching this.":
    "Дельфін у FBWA зазвичай PTCH_RATE, не TCONST. Спочатку Rate.",
  "RLL / PTCH": "RLL / PTCH",
  Rate: "rate",
  "Rate · FF first, then P I D": "Rate · спочатку FF, потім P I D",
  Response: "відгук",
  "Roll angle": "кут крену",
  "SPDWEIGHT 0 = pitch holds height; 2 = pitch holds speed (glider); 1 = mix. It is not a P gain. Tune pitch rate before TECS.":
    "SPDWEIGHT 0 = тангаж тримає висоту; 2 = тангаж тримає швидкість (глайдер); 1 = суміш. Це не P. Спочатку pitch rate, потім TECS.",
  "Same AC_PID as roll, into elevator. Default P is about half of roll — the tail is a different surface.":
    "Той самий AC_PID, що на крені, на руль висоти. Типове P приблизно вдвічі менше за крен — хвіст інша поверхня.",
  "Same PID, different plant": "Той самий PID, інша рослина",
  "Same idea as roll, for elevator. PTCH2SRV_RLL adds pitch in a bank so the nose does not drop.":
    "Та сама ідея, що на крені, для руля висоти. PTCH2SRV_RLL додає тангаж у крені, щоб ніс не падав.",
  Scope: "графік",
  "Soft tracking is often a weak roll loop, not L1. Tune Rate first. Raising period will not hold a wing that cannot hold bank.":
    "М’який трек часто слабкий roll, не L1. Спочатку Rate. Більший period не втримає крило, яке не тримає крен.",
  Steer: "кермо",
  "Steer is idle above GROUND_STEER_ALT ({alt} m). This is the runway loop, not flight yaw.":
    "Steer мовчить вище GROUND_STEER_ALT ({alt} м). Це контур смуги, не польотний yaw.",
  Surfaces: "поверхні",
  surfaces: "поверхні",
  "Surfaces + throttle. Same FF at two speeds is a different machine.":
    "Поверхні + газ. Той самий FF на двох швидкостях — інша машина.",
  "TECS energy": "енергія TECS",
  "TECS · height and airspeed share energy": "TECS · висота й швидкість ділять енергію",
  "TECS: height and airspeed are one energy. Pitch and throttle share the work.":
    "TECS: висота й повітряна швидкість — одна енергія. Тангаж і газ ділять роботу.",
  "The loop you actually fly: demanded °/s → aileron. FF is the lead term — like the stick in MANUAL. P/I/D trim the rest.":
    "Контур, яким реально літаєте: задані °/с → елерон. FF — головний член, як стик у MANUAL. P/I/D дорізають решту.",
  "This is runway tracking, not flight yaw. If it fights you in the air, GROUND_STEER_ALT is too high.":
    "Це тримання смуги, не польотний yaw. Якщо б’ється в повітрі — GROUND_STEER_ALT зависокий.",
  "Total energy: height and airspeed together. Pitch demand and throttle demand — not PSC_D. Open the Energy tab to set limits and SPDWEIGHT.":
    "Повна енергія: висота й швидкість разом. Завдання тангажу й газу — не PSC_D. Вкладка Energy — межі й SPDWEIGHT.",
  Navigate: "Navigate",
  "Navigate outside: L1 and TECS. Angle and rate in the body. Airspeed is the plant.":
    "Navigate зовні: L1 і TECS. Кут і rate в тілі. Повітряна швидкість — рослина.",
  "L1 / TECS": "L1 / TECS",
  "Tune after the wing holds bank in FBWA. NAVL1_PERIOD smaller = tighter turns. TECS_SPDWEIGHT is a mix, not a P gain.":
    "Тюніть, коли крило вже тримає крен у FBWA. Менший NAVL1_PERIOD — тісніші розвороти. TECS_SPDWEIGHT — суміш, не P.",
  "Tune in FBWA, not MANUAL. FF until desired rate matches achieved, then I = FF, then P, then D. Pitch P is usually about half of roll.":
    "Тюніть у FBWA, не в MANUAL. FF, доки заданий rate збіжиться з фактом, далі I = FF, потім P, потім D. Pitch P зазвичай близько половини roll.",
  "Tune inner loops in FBWA, not MANUAL. Feedforward first until the rate target and the gyro match, then I = FF, then P, then D. Pitch numbers are independent of roll.":
    "Внутрішні контури в FBWA, не в MANUAL. Спочатку FF, доки ціль rate і гіро збіжаться, далі I = FF, потім P, потім D. Числа тангажу незалежні від крену.",
  "Tune pitch rate first. If height oscillates after that, raise TECS_TIME_CONST, not a fake height P.":
    "Спочатку pitch rate. Якщо висота потім осцилює — піднімайте TECS_TIME_CONST, не вигаданий P висоти.",
  "V {v} m/s   gs {gs} m/s   W {w}": "V {v} м/с   gs {gs} м/с   W {w}",
  "We want an angle. The stick does not move the servo — FF does, scaled by airspeed.":
    "Хочемо кут. Стік не рухає серво — це робить FF, масштабований швидкістю.",
  YAW2SRV_DAMP: "YAW2SRV_DAMP",
  "Yaw damper": "демпфер рискання",
  "Yaw damper on the rudder. Not copter yaw P. YAW_RATE is ACRO-only.":
    "Демпфер рискання на рулі напряму. Не copter yaw P. YAW_RATE лише ACRO.",
  "Yaw damper · rudder": "демпфер рискання · руль",
  "Yaw defaults to a damper (YAW2SRV), not a rate PID. Ground steering (STEER2SRV) only runs below GROUND_STEER_ALT.":
    "Yaw за замовчуванням — демпфер (YAW2SRV), не rate PID. Кермо на землі (STEER2SRV) лише нижче GROUND_STEER_ALT.",
  "Yaw in FBWA is YAW2SRV damper, not YAW_RATE. Ground steering is STEER2SRV, only below GROUND_STEER_ALT.":
    "Yaw у FBWA — демпфер YAW2SRV, не YAW_RATE. Кермо на землі — STEER2SRV, лише нижче GROUND_STEER_ALT.",
  "actual {ang}°   target {tar}°   stick {cmd}°   V {v} m/s":
    "факт {ang}°   ціль {tar}°   стик {cmd}°   V {v} м/с",
  aileron: "елерон",
  "aileron · elevator · rudder": "елерон · руль висоти · руль напряму",
  "aileron · elevator · rudder · throttle": "елерон · руль висоти · руль напряму · газ",
  airspeed: "повітряна швидкість",
  "airspeed scaler": "scaler швидкості",
  "airspeed, m/s": "повітряна швидкість, м/с",
  "boundary · bank becomes desired angle": "межа · крен стає бажаним кутом",
  closed: "замкнено",
  cruise: "круїз",
  damper: "демпфер",
  "damper, not PID letters": "демпфер, не літери PID",
  desired: "завдання",
  "desired pitch": "бажаний тангаж",
  "desired roll": "бажаний крен",
  elevator: "руль висоти",
  "energy, not PID": "енергія, не PID",
  "error {err}°": "помилка {err}°",
  "ground PID": "PID землі",
  gyro: "гіро",
  idle: "мовчить",
  "lead term": "провідний член",
  loop: "контур",
  "m/s · scaler": "м/с · scaler",
  "pitch + throttle": "тангаж + газ",
  rudder: "руль напряму",
  servo: "серво",
  "set in FBWA before trusting TECS": "виставити в FBWA, перш ніж довіряти TECS",
  "side · airspeed": "збоку · швидкість",
  "sometimes · after rate": "інколи · після rate",
  "thr {v}%": "газ {v}%",
  "T {v}%": "T {v}%",
  "Y {v}°": "Y {v}°",
  "top · track": "згори · трек",
  "track · energy": "трек · енергія",
  "tune · FBWA first": "тюнінг · спочатку FBWA",
  wheel: "колесо",
  "wheel / rudder": "колесо / руль",
  "° · body → servo": "° · тіло → серво",
  "° · pitch": "° · тангаж",
  "° · roll": "° · крен",
  "°/s · aileron": "°/с · елерон",
  "°/s · elevator": "°/с · руль висоти",

  "No vehicle yet": "немає апарата",
  "See the loop the mode is actually closing.": "Побачити контур, який режим справді замикає.",
  "ArduLoops is a live stand, not Mission Planner and not Autotune. Paste a MAVLink URL in the header, click Link, HEARTBEAT picks copter or plane.":
    "ArduLoops — живий стенд, не Mission Planner і не Autotune. Вставте MAVLink URL у шапку, Link, HEARTBEAT вибере copter або plane.",
  "We want an angle. On a copter we command the rate that takes us there. On a wing the stick in FBWA is an angle — FF, scaled by airspeed, moves the servo.":
    "Хочемо кут. На коптері командуємо rate, який туди веде. На крилі стик у FBWA — кут: серво рухає FF, масштабований швидкістю.",
  "How to use the rest": "Як користуватись рештою",
  "Link SITL (or any MAVLink vehicle). The header stays the same for both frames.":
    "Підключіть SITL (або будь-який MAVLink). Шапка однакова для обох рам.",
  "Copter: Layers is the map, Loop is the selected card as a scheme, Scope is any Watch traces. Axis buttons exist because one rate block serves roll, pitch, yaw and height.":
    "Copter: Layers — карта, Loop — вибрана картка як схема, Scope — будь-які траси Watch. Кнопки осі є, бо один rate-блок обслуговує roll, pitch, yaw і висоту.",
  "Plane: Map already shows roll and pitch as separate cards. Open Rate for FF-first, Energy for TECS, Steer for the runway, Scope for traces.":
    "Plane: на карті roll і pitch уже окремі картки. Rate — спочатку FF, Energy — TECS, Steer — смуга, Scope — траси.",
  "Dimmed blocks are idle in this mode. You can still read gains; they will not change behaviour until the mode closes the loop.":
    "Приглушені блоки в цьому режимі мовчать. Gains можна читати; поведінку змінять лише коли режим замкне контур.",
  "Each SITL TCP port accepts one client. Typical URLs:":
    "Кожен TCP-порт SITL приймає одного клієнта. Типові URL:",
  URL: "URL",
  "Typical use": "типове",
  "SITL with --no-mavproxy (SERIAL0)": "SITL з --no-mavproxy (SERIAL0)",
  "Extra SITL GCS / MAVProxy first extra": "додатковий GCS SITL / перший extra MAVProxy",
  "If 5763 is already taken": "якщо 5763 уже зайнятий",
  "UDP listen (GCS-style)": "слухати UDP (як GCS)",
  "Start SITL": "запуск SITL",
  "Build the tree first:": "Спочатку зберіть дерево:",
  "Setting up the Build Environment": "налаштування середовища збірки",
  "If ArduLoops is the only GCS, start without MAVProxy and Link 5760.":
    "Якщо ArduLoops єдиний GCS — стартуйте без MAVProxy і Link на 5760.",
  "Host OS": "ОС",
  "Windows (WSL)": "Windows (WSL)",
  macOS: "macOS",
  Linux: "Linux",
  "this machine": "ця машина",
  "On Windows run SITL inside WSL.": "На Windows SITL запускайте в WSL.",
  "WSL build setup": "збірка в WSL",
  "SITL on Windows using WSL": "SITL на Windows через WSL",
  "SITL simulator": "симулятор SITL",
  "macOS build setup": "збірка на macOS",
  "Linux build setup": "збірка на Linux",
  "Then Link tcpout:127.0.0.1:5760.": "Далі Link tcpout:127.0.0.1:5760.",
  "Then Link tcpout:127.0.0.1:5760. If Windows cannot reach WSL localhost, use the address from hostname -I.":
    "Далі Link tcpout:127.0.0.1:5760. Якщо Windows не бачить localhost WSL — адреса з hostname -I.",
  "Copter wiki": "wiki коптера",
  "First Time Setup": "перше налаштування",
  "Tuning Process Instructions": "інструкція процесу тюнінгу",
  "Stabilize for rate. PSC usually stays at defaults.":
    "Stabilize для rate. PSC зазвичай лишають типовим.",
  "Plane wiki": "wiki крила",
  "Tuning Quickstart": "швидкий старт тюнінгу",
  "Roll, Pitch and Yaw": "крен, тангаж і рискання",
  "L1 navigation": "навігація L1",
  "Ground steering": "кермо на землі",
  "FBWA for inner loops. TECS after the wing holds bank.":
    "FBWA для внутрішніх контурів. TECS — коли крило вже тримає крен.",
  "Live MAVLink only: ATTITUDE, PID_TUNING, VFR_HUD, watched parameters. Copter ATC_* / PSC_*. Plane RLL_* / PTCH_* / YAW2SRV_* / NAVL1_* / TECS_* / STEER2SRV_*.":
    "Лише живий MAVLink: ATTITUDE, PID_TUNING, VFR_HUD, відстежувані параметри. Copter ATC_* / PSC_*. Plane RLL_* / PTCH_* / YAW2SRV_* / NAVL1_* / TECS_* / STEER2SRV_*.",
  "Out of scope: QuadPlane, autoland flare, full harmonic-notch wizard, Mission Planner’s full tree, log FFT. If the wiki and this stand disagree, the wiki wins.":
    "Поза стендом: QuadPlane, flare автопосадки, повний harmonic-notch, повне дерево Mission Planner, FFT лога. Якщо wiki і стенд розходяться — wiki.",
  "Same text in the repo: docs/start.md (readable on GitHub).":
    "Той самий текст у репозиторії: docs/start.md (читається на GitHub).",
  "AUTO / LOITER / RTL write a ground track and an altitude to hold. Not a PID. Plane has no PosControl — there is no PSC_* stack on a wing (QuadPlane Q_P is out of scope).":
    "AUTO / LOITER / RTL пишуть трек на землі й висоту, яку тримати. Не PID. На крилі немає PosControl — немає стеку PSC_* (QuadPlane Q_P поза стендом).",
  "Drifting off the line is often a weak roll loop, not L1. Tune Rate in FBWA before touching NAVL1_PERIOD or WP_RADIUS.":
    "Зліт з лінії часто слабкий roll loop, не L1. Спочатку Rate в FBWA, потім NAVL1_PERIOD чи WP_RADIUS.",
  "track · altitude": "трек · висота",
  Throttle: "газ",
  "% · throttle": "% · газ",
  "Separate from the wing surfaces. TECS writes this in AUTO / FBWB / CRUISE. In FBWA and MANUAL the left stick is still throttle. Open Energy for the mix.":
    "Окремо від поверхонь крила. TECS пише це в AUTO / FBWB / CRUISE. У FBWA і MANUAL лівий стик і є газ. Energy — для суміші.",
  "This is not a height PID. If climb oscillates, pitch rate first, then TECS_TIME_CONST — do not hunt a throttle P.":
    "Це не PID висоти. Якщо набір осцилює — спочатку pitch rate, потім TECS_TIME_CONST, не шукайте P газу.",
  "FBWA throttle": "газ FBWA",
  "hold alt": "тримати висоту",
  "alt / cruise": "висота / круїз",
  coordinate: "координація",
  course: "курс",
  track: "трек",
  "Link a vehicle. HEARTBEAT picks copter or plane. The wiki is the protocol — this stand shows the loops.":
    "Підключіть апарат. HEARTBEAT вибере copter або plane. Wiki — протокол, стенд показує контури.",
  AHRS: "AHRS",
  Aileron: "елерон",
  Elevator: "руль висоти",
  Rudder: "руль напряму",
  Nose: "ніс",
  Camera: "камера",
  rear: "ззаду",
  side: "збоку",
  top: "згори",
  sensor: "сенсор",
  "measured roll": "виміряний крен",
  "measured bank": "виміряний крен",
  "roll surface": "поверхня крену",
  "pitch surface": "поверхня тангажу",
  "yaw surface": "поверхня рискання",
  "{v}°": "{v}°",
  "Aileron, elevator, rudder, throttle, nose. Same FF at two speeds is a different machine.":
    "Елерон, руль висоти, руль напряму, газ, ніс. Той самий FF на двох швидкостях — інша машина.",
  "Not AC_PID. YAW2SRV_DAMP damps gyro z. YAW2SRV_RLL multiplies by sin(AHRS roll) — measured bank, not the roll-rate PID. YAW_RATE_* is ACRO-only and off by default.":
    "Не AC_PID. YAW2SRV_DAMP гасить gyro z. YAW2SRV_RLL множить на sin(крену AHRS) — виміряний крен, не roll-rate PID. YAW_RATE_* лише ACRO і за замовчуванням вимкнений.",
  "Flying wings with no fuselage skip sideslip (SLIP). Tune KFF_RDDRMIX / DAMP before INT. Do not treat this as copter yaw P. Do not wire RLL_RATE into this block in your head.":
    "Літаюче крило без фюзеляжу пропускає sideslip (SLIP). Спочатку KFF_RDDRMIX / DAMP, потім INT. Це не copter yaw P. Не проводьте сюди RLL_RATE у голові.",
  "Not a loop. YAW2SRV_RLL reads sin(this bank) plus gyro z and lateral accel. It does not read RLL_RATE or the roll-angle PID.":
    "Не контур. YAW2SRV_RLL читає sin(цього крену) плюс gyro z і бічне прискорення. Не читає RLL_RATE і не roll-angle PID.",
  "Wiring this to the roll-rate output is the convenient lie. The damper uses the measured attitude, even while the rate loop is still catching up.":
    "Підключати це до виходу roll-rate — зручна брехня. Демпфер бере виміряний attitude, навіть поки rate ще наздоганяє.",
  "RLL_RATE writes this channel. Roll (and pitch) authority scales with airspeed² around SCALING_SPEED. Same FF at two speeds is a different plant.":
    "RLL_RATE пише цей канал. Влада крену (і тангажу) масштабується airspeed² навколо SCALING_SPEED. Той самий FF на двох швидкостях — різна рослина.",
  "PTCH_RATE writes this channel. Same SCALING_SPEED as aileron — not a second plant knob.":
    "PTCH_RATE пише цей канал. Той самий SCALING_SPEED, що на елероні — не другий важіль рослини.",
  "If the nose porpoises, the pitch rate loop is still wrong. Do not hunt a new elevator P here.":
    "Якщо ніс дельфінить — ще кривий pitch rate. Не шукайте тут нове P руля висоти.",
  "YAW2SRV writes this in the air. Separate from the nosewheel. KFF_RDDRMIX can add aileron into this channel — that is a mix, not the damper.":
    "YAW2SRV пише це в повітрі. Окремо від носового колеса. KFF_RDDRMIX може додати елерон у цей канал — це mix, не демпфер.",
  "A flying wing with no fuselage still has this PWM if you mapped a rudder; the damper may be doing almost nothing useful.":
    "Літаюче крило без фюзеляжу все одно має цей PWM, якщо ви прописали руль; демпфер може майже нічого не робити.",
  "SERVOx function GroundSteering. STEER2SRV writes this below GROUND_STEER_ALT. Not the rudder.":
    "Функція SERVOx GroundSteering. STEER2SRV пише це нижче GROUND_STEER_ALT. Не руль напряму.",
  "If the wheel fights you in the air, GROUND_STEER_ALT is too high. This channel is idle above that height.":
    "Якщо колесо б’ється в повітрі — GROUND_STEER_ALT зависокий. Вище цієї висоти канал мовчить.",
  "Yaw in FBWA is YAW2SRV damper. YAW2SRV_RLL reads AHRS roll (measured bank), not RLL_RATE. Ground steering is STEER2SRV, only below GROUND_STEER_ALT.":
    "Yaw у FBWA — демпфер YAW2SRV. YAW2SRV_RLL читає крен AHRS (виміряний), не RLL_RATE. Кермо на землі — STEER2SRV, лише нижче GROUND_STEER_ALT.",
  "command · plant": "команда · рослина",
  "dashed · no P I D": "пунктир · без P I D",
  "dashed · no knobs": "пунктир · без кнобів",
  "no knobs": "без кнобів",
  "A letter on a card is a knob: P I D, or TCONST, DAMP, PERIOD. Dashed cards have none — AHRS measures, a surface is PWM.":
    "Літера на картці — кноб: P I D, або TCONST, DAMP, PERIOD. Пунктирні картки не мають кнобів — AHRS міряє, поверхня це PWM.",
  "A letter on a card is a knob: P I D, or TC, ANGLE_MAX, hover. Left bar is first flight; the Loiter stack comes after attitude.":
    "Літера на картці — кноб: P I D, або TC, ANGLE_MAX, hover. Смуга зліва — перший політ; стек Loiter після attitude.",
  targets: "цілі",
  "track → bank": "трек → крен",
  "energy mix": "суміш енергії",
  "rate + FF": "rate + FF",
  runway: "смуга",
  geometry: "геометрія",
  mixer: "мікшер",
  "speed → lean": "швидкість → lean",
  "climb → accel": "набір → accel",
  "accel → throttle": "accel → газ",
  "on gyro z": "на gyro z",
  "How this mode flies": "Як літає цей режим",
  "In FBWA the stick is an angle; rate FF moves the servo, scaled by airspeed. Pitch numbers are independent of roll.":
    "У FBWA стик — це кут; rate FF рухає серво, масштабоване airspeed. Цифри тангажу незалежні від крену.",
  "AUTO / LOITER / RTL: L1 asks for bank, TECS shares height and airspeed into pitch and throttle.":
    "AUTO / LOITER / RTL: L1 просить крен, TECS ділить висоту й airspeed на тангаж і газ.",
  "Yaw is a damper on the rudder (YAW2SRV). Ground steering writes the nosewheel only below GROUND_STEER_ALT.":
    "Yaw — демпфер на рулі напряму (YAW2SRV). Кермо на землі пише носове колесо лише нижче GROUND_STEER_ALT.",
  "L1 turns cross-track error into a desired bank for the roll loop. TECS shares height and airspeed: one energy, two outputs — pitch and throttle. Live in AUTO / LOITER / RTL / GUIDED / TAKEOFF; TECS also in FBWB / CRUISE.":
    "L1 перетворює помилку треку на бажаний крен для контуру roll. TECS ділить висоту й airspeed: одна енергія, два виходи — тангаж і газ. Живий в AUTO / LOITER / RTL / GUIDED / TAKEOFF; TECS також у FBWB / CRUISE.",
  "Tune after the wing holds bank in FBWA. NAVL1_PERIOD smaller = tighter turns. TECS_SPDWEIGHT mixes height vs speed: 0 height, 2 speed, 1 both.":
    "Налаштовуйте після того, як крило тримає крен у FBWA. Менший NAVL1_PERIOD — тугіший розворот. TECS_SPDWEIGHT мішає висоту й швидкість: 0 висота, 2 швидкість, 1 обидва.",
  "Angle error becomes a rate command (TCONST). Rate FF then moves aileron or elevator. Authority grows with airspeed. Tune in FBWA.":
    "Помилка кута стає завданням rate (TCONST). Далі rate FF рухає елерон або руль висоти. Влада росте зі швидкістю. Настройка в FBWA.",
  "Yaw is a damper on the rudder: DAMP resists gyro z; RLL coordinates from measured AHRS bank. Ground steer writes the nosewheel below GROUND_STEER_ALT.":
    "Yaw — демпфер на рулі напряму: DAMP гасить gyro z; RLL координує з виміряного крену AHRS. Кермо на землі пише носове колесо нижче GROUND_STEER_ALT.",
  "In FBWA the stick asks for roll and pitch angle; the left stick is still throttle. In MANUAL the stick is the surface. In ACRO the stick is a rate. AUTO / RTL ignore the stick for the path.":
    "У FBWA стик просить кут крену й тангажу; лівий стик лишається газом. У MANUAL стик — це поверхня. У ACRO стик — rate. AUTO / RTL ігнорують стик для шляху.",
  "In AUTO / LOITER / RTL / GUIDED / TAKEOFF this writes the ground track and the altitude to hold. WP_RADIUS is how close is ‘there’; WP_LOITER_RAD is the circle.":
    "В AUTO / LOITER / RTL / GUIDED / TAKEOFF пише наземний трек і висоту, яку тримати. WP_RADIUS — наскільки близько «там»; WP_LOITER_RAD — коло.",
  "Reads cross-track error and asks the roll loop for a bank. Period is the main knob — smaller is a tighter turn. Live whenever nav is flying the line.":
    "Читає помилку треку й просить у контуру roll крен. Period — головний важіль: менше — тугіший розворот. Живий, коли nav веде лінію.",
  "Shares height and airspeed: one energy, two outputs — desired pitch and throttle. Live in AUTO / FBWB / CRUISE / RTL / LOITER. Open Energy for limits and SPDWEIGHT.":
    "Ділить висоту й airspeed: одна енергія, два виходи — бажаний тангаж і газ. Живий в AUTO / FBWB / CRUISE / RTL / LOITER. Відкрийте Energy для лімітів і SPDWEIGHT.",
  "SPDWEIGHT 0 = pitch holds height; 2 = pitch holds speed (glider); 1 = mix. Tune pitch rate before TECS.":
    "SPDWEIGHT 0 = тангаж тримає висоту; 2 = тангаж тримає швидкість (планер); 1 = суміш. Спочатку pitch rate, потім TECS.",
  "Turns demanded bank into a roll-rate command. FBWA / TRAINING / STABILIZE / FBWB / CRUISE: the stick is the demand. AUTO: L1 writes the demand. TCONST is how fast that happens. If ANGLE_P is 0, P = 1/TCONST.":
    "Перетворює заданий крен на команду roll-rate. FBWA / TRAINING / STABILIZE / FBWB / CRUISE: стик — це завдання. AUTO: L1 пише завдання. TCONST — наскільки швидко. Якщо ANGLE_P = 0, P = 1/TCONST.",
  "Turns demanded pitch into an elevator-rate command. FBWA: the stick. AUTO / FBWB: TECS writes the demand. PTCH2SRV_RLL adds pitch in a bank so the nose does not drop.":
    "Перетворює заданий тангаж на команду elevator-rate. FBWA: стик. AUTO / FBWB: TECS пише завдання. PTCH2SRV_RLL додає тангаж у крені, щоб ніс не падав.",
  "Turns demanded °/s into aileron. FF is the lead — like the stick in MANUAL. Then I = FF, then P, then D. Live in every flying mode except MANUAL.":
    "Перетворює задані °/s на елерон. FF — випередження, як стик у MANUAL. Далі I = FF, потім P, потім D. Живий у всіх льотних режимах крім MANUAL.",
  "Turns demanded °/s into elevator. Same FF-first order as roll. Default P is about half of roll — the tail is a different surface.":
    "Перетворює задані °/s на руль висоти. Той самий порядок FF-спочатку, що на крені. Типове P приблизно вдвічі менше за крен — хвіст інша поверхня.",
  "In FBWA and the nav modes this writes the rudder. DAMP resists gyro z. RLL coordinates the turn from measured AHRS bank (sin of roll). YAW_RATE_* exists only in ACRO and is off by default.":
    "У FBWA і nav-режимах пише руль напряму. DAMP гасить gyro z. RLL координує розворот з виміряного крену AHRS (sin крену). YAW_RATE_* існує лише в ACRO і за замовчуванням вимкнений.",
  "Flying wings with no fuselage skip SLIP. Tune DAMP / KFF_RDDRMIX before INT. Coordination uses AHRS roll even while the rate loop is still catching up.":
    "Літаючі крила без фюзеляжу пропускають SLIP. Налаштуйте DAMP / KFF_RDDRMIX перед INT. Координація бере крен AHRS, навіть поки rate-контур ще наздоганяє.",
  "Measured attitude. The yaw damper reads sin(this bank), gyro z and lateral accel. Always measuring; the damper uses it whenever yaw is in the loop.":
    "Виміряний attitude. Yaw-демпфер читає sin(цього крену), gyro z і бічне прискорення. Завжди міряє; демпфер бере це, коли yaw у контурі.",
  "The damper uses this bank now, even while the rate loop is still catching up.":
    "Демпфер бере цей крен зараз, навіть поки rate-контур ще наздоганяє.",
  "Tracks heading on the ground and writes the nosewheel. Live in every mode except MANUAL, only below GROUND_STEER_ALT. Open the Steer tab.":
    "Тримає курс на землі й пише носове колесо. Живий у всіх режимах крім MANUAL, лише нижче GROUND_STEER_ALT. Відкрийте вкладку Steer.",
  "The throttle channel. TECS writes it in AUTO / FBWB / CRUISE / RTL / LOITER. In FBWA, ACRO and MANUAL the left stick is still throttle. Open Energy for the mix.":
    "Канал газу. TECS пише його в AUTO / FBWB / CRUISE / RTL / LOITER. У FBWA, ACRO і MANUAL лівий стик лишається газом. Відкрийте Energy для суміші.",
  "If climb oscillates, pitch rate first, then TECS_TIME_CONST — do not hunt a throttle P.":
    "Якщо набір коливається — спочатку pitch rate, потім TECS_TIME_CONST. Не шукайте P газу.",
  "The roll surface. In the air, roll rate writes this channel. In MANUAL the stick writes it. Authority scales with airspeed² around SCALING_SPEED.":
    "Поверхня крену. У повітрі її пише roll rate. У MANUAL — стик. Влада масштабується airspeed² навколо SCALING_SPEED.",
  "The pitch surface. Pitch rate writes this in the air; the stick writes it in MANUAL. Same SCALING_SPEED as aileron.":
    "Поверхня тангажу. У повітрі її пише pitch rate; у MANUAL — стик. Той самий SCALING_SPEED, що на елероні.",
  "The yaw surface in the air. The damper writes it. Separate from the nosewheel. KFF_RDDRMIX can add aileron into this channel.":
    "Поверхня рискання в повітрі. Її пише демпфер. Окремо від носового колеса. KFF_RDDRMIX може додати елерон у цей канал.",
  "Nosewheel channel (GroundSteering). Ground steer writes it below GROUND_STEER_ALT. Idle above that height and in MANUAL.":
    "Канал носового колеса (GroundSteering). Кермо на землі пише його нижче GROUND_STEER_ALT. Мовчить вище цієї висоти й у MANUAL.",
  "The stick request. Stabilize wants an angle, AltHold a climb rate (PILOT_SPD_UP / DN), Loiter a lean/accel, Acro a rate. TC / ACC / Rmax only shape how fast that request may change (Input Shaping).":
    "Запит стика. Stabilize хоче кут, AltHold — швидкість набору (PILOT_SPD_UP / DN), Loiter — lean/accel, Acro — rate. TC / ACC / Rmax лише формують, як швидко цей запит може змінюватись (Input Shaping).",
  "Writes where PSC should hold, and how fast to get there. WP_SPD is mission cruise; LOIT_SPEED_MS is stick speed in Loiter. Live in Loiter / Auto / RTL — idle in Stabilize.":
    "Пише, де PSC має тримати, і як швидко туди летіти. WP_SPD — крейсер місії; LOIT_SPEED_MS — швидкість стика в Loiter. Живий у Loiter / Auto / RTL — мовчить у Stabilize.",
  "NE acceleration (earth, m/s²) becomes roll/pitch (body, °). ATC_ANGLE_MAX is the lean ceiling. Between PosControl and Attitude.":
    "Прискорення NE (земля, m/s²) стає roll/pitch (тіло, °). ATC_ANGLE_MAX — стеля lean. Між PosControl і Attitude.",
  "Mixer: rate torque plus vertical-accel throttle. Hover should sit near mid stick — that is MOT_THST_HOVER.":
    "Мікшер: момент від rate плюс газ від вертикального accel. Зависання має сидіти біля середини стика — це MOT_THST_HOVER.",
  "Holds where to be: position → velocity → acceleration. North–East is metres on the earth; Down is height. Horizontal output is lean. Vertical accel goes straight to throttle.":
    "Тримає де бути: позиція → швидкість → прискорення. North–East — метри на землі; Down — висота. Горизонтальний вихід — lean. Вертикальний accel іде прямо в газ.",
  "Vertical skips Attitude: Down acceleration (PSC_D_ACC) goes straight to throttle. Navigation writes the place and speed for PSC to hold.":
    "Вертикаль Attitude обходить: прискорення Down (PSC_D_ACC) одразу йде в газ. Navigation пише місце і швидкість, які PSC має тримати.",
  "WP, Loiter and Circle write targets for PosControl. Horizontal output is lean; vertical accel goes to throttle. Not shown: Plane, CC2_, FHLD, FOLL, heli.":
    "WP, Loiter і Circle пишуть цілі для PosControl. Горизонтальний вихід — lean; вертикальний accel іде в газ. Не показано: Plane, CC2_, FHLD, FOLL, heli.",
  "DAMP resists yaw rate; RLL coordinates from AHRS bank. Live in FBWA and the nav modes.":
    "DAMP гасить yaw rate; RLL координує з крену AHRS. Живий у FBWA і nav-режимах.",
  "In FBWA this is the rudder damper. Ground steering is the nosewheel, only below GROUND_STEER_ALT.":
    "У FBWA це демпфер руля напряму. Кермо на землі — носове колесо, лише нижче GROUND_STEER_ALT.",
  "Height and airspeed share energy. Pitch and throttle do the work. SPDWEIGHT: 0 height, 2 speed, 1 both.":
    "Висота й airspeed ділять енергію. Роботу роблять тангаж і газ. SPDWEIGHT: 0 висота, 2 швидкість, 1 обидва.",
  "Tracks heading on the runway. Every mode except MANUAL, only below GROUND_STEER_ALT.":
    "Тримає курс на смузі. Усі режими крім MANUAL, лише нижче GROUND_STEER_ALT.",
  "L1 looks at the track on the earth and asks the roll loop for a bank.":
    "L1 дивиться на трек на землі й просить у контуру roll крен.",
  "Damper on the rudder. DAMP on gyro z; RLL from measured bank. YAW_RATE is ACRO-only.":
    "Демпфер на рулі напряму. DAMP на gyro z; RLL з виміряного крену. YAW_RATE лише ACRO.",
};
