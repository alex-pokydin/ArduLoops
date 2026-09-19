# ArduLoops

Живий стенд, щоб **бачити** контури ArduPilot. Це не Mission Planner, не Autotune і не заміна wiki. Підключіть апарат; HEARTBEAT вибере **copter** або **plane**; далі дивіться, які контури поточний режим справді замикає.

Хочемо кут. На коптері командуємо rate, який туди веде. На крилі стик у FBWA — кут: серво рухає **FF**, масштабований швидкістю.

Вставте MAVLink URL у шапку і натисніть **Link**. Або відкрийте **SITL** і **старт**.

![Графік: кут, який хочемо, і rate, який командуємо](plot.png)

## Лінк

| URL | Типове |
| --- | --- |
| `tcpout:127.0.0.1:5770` | SITL зі стенда |
| `tcpout:127.0.0.1:5760` | SITL з `--no-mavproxy` (SERIAL0) |
| `tcpout:127.0.0.1:5763` | додатковий GCS SITL / перший extra MAVProxy |
| `tcpout:127.0.0.1:5762` | якщо 5763 уже зайнятий |
| `udpin:0.0.0.0:14550` | слухати UDP (як GCS). Борт має **надсилати** на цей порт. Інший GCS закрити. |
| `udpout:127.0.0.1:14550` | UDP-клієнт, коли слухає борт |

Кожен TCP-порт SITL приймає **одного** клієнта. Не направляйте два ArduLoops на той самий порт. WSL SITL `--out 127.0.0.1:14550` лишається в WSL — IP хоста Windows, або `--out udpbcast:0.0.0.0:14550`.

## Запуск SITL

**SITL** перед назвою відкриває ліву рейку. Коптер або крило, **старт**. Стенд завантажить sitl-exe, якщо треба, і Link `tcpout:127.0.0.1:5770`.

![SITL: мініатюри апарата і старт](sitl.png)

Щоб стартувати SITL самим, спочатку зберіть дерево: [налаштування середовища збірки](https://ardupilot.org/dev/docs/building-the-code.html). Якщо ArduLoops єдиний GCS, стартуйте апарат **без** MAVProxy:

### Windows (WSL)

[SITL на Windows через WSL](https://ardupilot.org/dev/docs/sitl-on-windows-wsl.html) після [збірки в WSL](https://ardupilot.org/dev/docs/building-setup-windows10.html).

```bash
wsl
cd ~/ardupilot
python3 Tools/autotest/sim_vehicle.py -v ArduCopter --no-mavproxy
# or:  -v ArduPlane --no-mavproxy
```

У ArduLoops **Link** `tcpout:127.0.0.1:5760`. WSL2 зазвичай прокидає цей порт на Windows. Якщо Link не береться — IP з `hostname -I`.

Типовий wiki-запуск (`--map --console`) стартує MAVProxy; тоді ArduLoops часто бере `tcpout:127.0.0.1:5763`.

### macOS / Linux

Той самий скрипт [SITL](https://ardupilot.org/dev/docs/sitl-simulator-software-in-the-loop.html) після збірки на [macOS](https://ardupilot.org/dev/docs/building-setup-mac.html) або [Linux](https://ardupilot.org/dev/docs/building-setup-linux.html):

```bash
cd ~/ardupilot
python3 Tools/autotest/sim_vehicle.py -v ArduCopter --no-mavproxy
# or:  -v ArduPlane --no-mavproxy
```

**Link** `tcpout:127.0.0.1:5760`.

## Після Link

HEARTBEAT.type монтує оболонку. Порожня рама, поки апарат не заговорить.

### Copter

![Шари: карта контурів коптера](cascade.png)

- **Layers** — PosControl (зовні) проти Attitude (всередині). Приглушені блоки в цьому режимі не замкнені
- **Loop** — вибрана картка як схема (rate / кут = AC_PID, висота й NE = PosControl P або PID). Кнопки осі (roll / pitch / yaw / height), бо **один** rate-блок обслуговує кожну вісь
- **Scope** — траси будь-якого набору Watch. Pause поруч із Watch; список — усі блоки, які цей режим замикає (rate: `PID_TUNING` desired vs achieved; кут: demand vs `ATTITUDE`)

Rate тюніть у **Stabilize**. Wool / Stock / Sharp — пресети відчуття на стенді, не протокол тюнінгу.

Wiki: [перше налаштування](https://ardupilot.org/copter/docs/initial-setup.html) · [процес тюнінгу](https://ardupilot.org/copter/docs/tuning-process-instructions.html)

### Plane

![Карта: L1 і TECS крила](plane-map.png)

- **Map** — команда (стик + цілі місії), L1 + TECS зовні (не PosControl), кут і rate крену/тангажа, демпфер рискання (крен AHRS, не RLL_RATE), кермо на землі, далі газ / ніс і елерон / руль висоти / руль напряму. Порожня карта показує живий шлях режиму; картка — лише своє in і out. Roll і pitch — **окремі картки**
- **Loop** — вибрана картка як схема (rate = AC_PID + FF, L1 = трек → крен, TECS = енергія → тангаж + газ, yaw = демпфер, steer = смуга)

![Контур: схема енергії TECS](plane-loop.png)

- **Scope** — траси будь-якого набору Watch. Pause поруч із Watch; список — усі блоки, які цей режим замикає (rate: `PID_TUNING`; кут: `nav_roll` / `nav_pitch` vs `ATTITUDE`)

Внутрішні контури тюніть у **FBWA**, не в MANUAL. Числа pitch незалежні від roll.

Wiki: [перше налаштування](https://ardupilot.org/plane/docs/first-time-setup.html) · [швидкий старт тюнінгу](https://ardupilot.org/plane/docs/tuning-quickstart.html) · [крен/тангаж/рискання](https://ardupilot.org/plane/docs/new-roll-and-pitch-tuning.html) · [TECS](https://ardupilot.org/plane/docs/tecs-total-energy-control-system-for-speed-height-tuning-guide.html) · [навігація L1](https://ardupilot.org/plane/docs/navigation-tuning.html) · [кермо на землі](https://ardupilot.org/plane/docs/tuning-ground-steering-for-a-plane.html)

## Межі

Стенд показує контури першого налаштування / перших польотів, наживо по MAVLink (`ATTITUDE`, `PID_TUNING`, `VFR_HUD`, відстежувані параметри).

**У стенді.** Copter `ATC_*` / `PSC_*`. Plane `RLL_*` / `PTCH_*` / `YAW2SRV_*` / `NAVL1_*` / `TECS_*` / `STEER2SRV_*`.

**Поза стендом.** QuadPlane, flare автопосадки, повний harmonic-notch, дерево параметрів Mission Planner, FFT / Autotune як протокол з лога. Якщо wiki і стенд розходяться — wiki.
