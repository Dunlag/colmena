# Colmena

Plugin de Orca que reúne, por máquina, la cola **Needs you** de Bob, los bots, los workers y las automatizaciones. Este hito expone el grafo y muestra su recuento en el panel. Los workers terminados con hora conocida se atenúan hasta que pasan 24 horas desde su finalización.

## Cómo probar

Desde este directorio, con la CLI de Orca disponible:

```sh
orca plugin test . --json
orca plugin check . --json
orca plugin validate . --json
```

El worker consulta la CLI del host en JSON. Su panel usa `grafo.obtener` para leer el grafo y recibe `grafo.actualizado` al refrescar. Las consultas de workspaces y workers vencen cada 4 s y las demás cada 20 s. Orca adelanta la consulta rápida cuando cambia un workspace o el estado de un agente. Si una consulta falla, el grafo sigue disponible e incluye el fallo.

Las pruebas usan extractos de salidas reales de Orca. Se sustituyeron los identificadores, nombres privados, textos y fechas, y se añadieron ejemplos para cubrir una cola pendiente y un worker sin modelo.
