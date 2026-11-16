// One microphone stream shared by voice following and recording. iPads and
// iPhones stop the first stream when a page asks for a second one, so both
// features borrow this one and it closes when the last one gives it back.
let stream = null;
let opening = null;
let users = 0;

function live(s) {
  return s && s.getAudioTracks().some((t) => t.readyState === "live");
}

export async function acquireMic(deviceId) {
  if (!live(stream)) {
    if (!opening) {
      opening = navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }).finally(() => { opening = null; });
    }
    stream = await opening;
  }
  users++;
  return stream;
}

export function releaseMic() {
  users = Math.max(0, users - 1);
  if (users === 0 && stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}
