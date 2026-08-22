# Demostración para clientes — Cumple Now

Esta versión presenta el flujo profesional para trabajadores en Android, iOS y navegador. Los datos de empleos, postulaciones y conversaciones son ficticios y están diseñados para una demostración segura.

## Inicio rápido sin Docker

Desde la raíz del proyecto:

```powershell
.\.tools\flutter\bin\flutter.bat run -d chrome --web-port 7357
```

Abre `http://localhost:7357`. En este modo el registro y el acceso se validan localmente; no se crea una cuenta real y no se necesita Docker.

## Datos sugeridos para la presentación

- Tipo de cuenta: `Quiero trabajar`
- Nombre: `Cliente Demo`
- Correo: `cliente@demo.pe`
- Contraseña: `Demo2026!`
- DNI de prueba: `12345678`

Todos estos datos son ficticios. También puede usarse cualquier correo válido, contraseña de ocho o más caracteres y DNI de ocho dígitos.

## Recorrido recomendado

1. Completa el onboarding como trabajador y crea la cuenta de demostración.
2. En `Inicio`, busca `mozo`, `hotel` o `Miraflores`.
3. Activa los filtros `Urgentes` y `Recomendados`, y después usa `Limpiar filtros`.
4. Guarda una oportunidad con el icono de marcador.
5. En escritorio, revisa el detalle lateral y pulsa `Postular ahora`.
6. Abre `Postulaciones` para mostrar las etapas del proceso.
7. Abre `Mensajes` para mostrar conversaciones seguras de ejemplo.
8. Abre `Perfil` para mostrar reputación, certificados y experiencia.
9. Usa `Datos de demostración` para alternar entre resultados normales, lista vacía y error simulado.

## Vistas adaptables

- Móvil: ancho de 320 a 599 px, navegación inferior y detalle en hoja modal.
- Tablet: ancho de 600 a 1023 px, navegación lateral y cuadrícula de oportunidades.
- Escritorio/web: desde 1024 px, barra lateral, resultados y detalle simultáneo.

En Chrome DevTools pueden probarse rápidamente 390 × 844, 834 × 1112 y 1440 × 900.

## Modo con API local y Docker

Cuando Docker Desktop esté listo:

```powershell
docker compose up --build
.\.tools\flutter\bin\flutter.bat run -d chrome --web-port 7357 --dart-define=USE_LOCAL_API=true
```

Este modo envía registro e inicio de sesión a `http://127.0.0.1:4000/api` y consulta la API local de empleos.

En Android Emulator, inicia Flutter con `--dart-define=API_BASE_URL=http://10.0.2.2:4000/api`. Para un celular físico conectado a la misma red Wi-Fi, usa la IP local de la laptop, por ejemplo `--dart-define=API_BASE_URL=http://192.168.1.50:4000/api`, y permite el puerto 4000 en el firewall de Windows.

## Límites visibles de esta entrega

- No se contacta a empleadores reales al postular.
- Pagos y retiros reales permanecen desactivados.
- Cámara, GPS, foto de DNI y reconocimiento facial permanecen desactivados.
- La validación DNI/rostro es una idea preparada para integrar cuando se contrate un proveedor autorizado.
- Los mensajes, estados y empleos del modo demostración no son persistentes.
