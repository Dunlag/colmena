# Colmena

Plugin de Orca que reúne la cola **Needs you** de Bob, los bots, los workers y las automatizaciones. El panel muestra el recuento del grafo, que agrupa los nodos por máquina. Un mismo identificador en dos máquinas representa dos nodos. Los workers terminados con hora conocida se atenúan hasta que pasan 24 horas desde su finalización.

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

El panel usa `grafo.obtener` para leer el grafo y recibe `grafo.actualizado` al refrescar. El worker inicia una nueva ronda de workspaces, workers y terminales a los 4 s de completar la anterior. Los bots, trabajos, pendientes, mensajes y automatizaciones se vuelven a consultar a los 20 s. Los cambios de workspace y de estado de los agentes adelantan la ronda rápida.

Las pruebas usan extractos anonimizados de Orca y respuestas simuladas de Deck y Chopper con la estructura de la CLI. Cubren el hook y su almacenamiento, la caducidad, los identificadores repetidos en distintas máquinas y un servidor que no responde.
