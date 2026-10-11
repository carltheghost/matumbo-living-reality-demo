const CANCELED_MESSAGE = 'Camera start canceled or stopped. Touch controls remain available.';

export async function startCameraFromButton({ facing, start, status, activeMessage, canceledMessage = CANCELED_MESSAGE }) {
  try {
    const started = await start(facing);
    status(started === true ? activeMessage : canceledMessage);
    return started;
  } catch (error) {
    const message = error?.message || String(error);
    status(`${message} Touch controls remain available.`);
    return false;
  }
}
