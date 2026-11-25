# Colmena

Plugin de Orca que reúne la cola **Needs you** de Bob, los bots, los workers y las automatizaciones.

## Pestaña de Colmena

En un espacio de trabajo local, pulsa **Abrir colmena** en el panel lateral o busca el mismo comando en la paleta. El comando crea o reutiliza `Colmena.colmena` en la raíz de ese espacio. Es un archivo de enlace para el editor de Orca. El grafo, las tareas y los mensajes se reciben del worker y quedan fuera del archivo.

La pestaña muestra **TÚ → Bob → bots → workers** y las automatizaciones, con una columna por máquina. Cada tarjeta muestra el estado, la máquina, el modelo o tipo de agente, la tarea y el tiempo transcurrido. Un mismo identificador en dos máquinas representa dos nodos. Los workers terminados con hora conocida se atenúan hasta que pasan 24 horas desde su finalización.

Las tarjetas se recorren con **Tab**. Pulsa **Enter** o haz clic para abrir el terminal o el espacio asociado. Las tarjetas que Orca no puede vincular a un destino siguen siendo legibles con el teclado. En un servidor emparejado se usa el identificador de terminal de ese servidor.

**Últimos flujos** muestra hasta 20 mensajes ordenados por hora. En **Completo**, cada mensaje de menos de 30 segundos tiene un punto que recorre su conexión si ambos extremos tienen la animación activada. El ajuste se guarda por máquina y empieza en **Ahorro**. La preferencia de movimiento reducido fuerza **Ahorro** y las animaciones y redibujos se suspenden cuando la pestaña se oculta. La pestaña sigue el tema claro u oscuro de Orca.

## Modelos y máquinas

Colmena requiere Orca 1.4.248 o posterior. El hook `agent.launch.before` observa el lanzamiento y deja que Orca continúe de inmediato. Cuando Orca da un identificador de terminal, el plugin guarda en `storage:own` el tipo de agente, el modelo explícito si lo hay, la máquina y la hora. Solo lee `--model valor`, `--model=valor` y `-m valor` en los agentes que lo admiten. El comando, el entorno y el prompt quedan fuera del almacenamiento.

El grafo usa el modelo guardado cuando puede asociarlo al worker. Orca también puede informar el modelo en sus propias fuentes. Si ninguna fuente lo conoce, se muestra el tipo de agente. El registro caduca a las 24 horas y se depura antes si un inventario completo confirma que el terminal ya no existe. La captura del hook se realiza en el Orca que ejecuta el plugin y depende de que el evento incluya un identificador de terminal.

El lector descubre los servidores emparejados con `orca environment list --json`. Consulta la máquina local y cada servidor guardado en serie con `--environment`. Cada proceso tiene un límite de 2,5 segundos. El listado de bots local dispone de 6 segundos porque Orca espera a los servidores antes de devolver sus propios bots. Si un servidor no responde, el grafo conserva su nodo, atribuye los fallos a esa máquina y muestra los datos de las demás.

## Cómo probar

Desde este directorio, con la CLI de Orca disponible:

```sh
orca plugin test . --json
orca plugin check . --json
orca plugin validate . --json
```

El panel y la pestaña usan `grafo.obtener` para leer el grafo y reciben `grafo.actualizado` al refrescar. El worker inicia una nueva ronda de workspaces, workers y terminales a los 4 s de completar la anterior. Los bots, trabajos, pendientes, mensajes y automatizaciones se vuelven a consultar a los 20 s. Los cambios de workspace y de estado de los agentes adelantan la ronda rápida.

Las pruebas usan extractos anonimizados de Orca y respuestas simuladas de Deck y Chopper. Cubren la ventana de 30 segundos, la disposición sin solapes con 1, 5 y 30 nodos, el hook, la caducidad y los casos en que se repiten identificadores o falla un servidor. `plugin check` renderiza el panel con los fixtures y comprueba estáticamente el editor.
