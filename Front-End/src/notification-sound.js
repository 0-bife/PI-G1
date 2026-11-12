export async function playNotificationSound() {
	let context;
	try {
		const AudioContextConstructor = window.AudioContext;
		if (!AudioContextConstructor) return;

		context = new AudioContextConstructor();
		if (context.state === 'suspended') await context.resume();
		if (context.state !== 'running') {
			await context.close();
			return;
		}

		const oscillator = context.createOscillator();
		const volume = context.createGain();
		const now = context.currentTime;

		oscillator.type = 'sine';
		oscillator.frequency.setValueAtTime(880, now);
		volume.gain.setValueAtTime(0.0001, now);
		volume.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
		volume.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
		oscillator.connect(volume);
		volume.connect(context.destination);
		oscillator.onended = () => {
			void context.close().catch(() => {});
		};
		oscillator.start(now);
		oscillator.stop(now + 0.19);
	} catch {
		if (context && context.state !== 'closed') {
			try {
				await context.close();
			} catch {
				// Audio playback may be blocked until the user interacts with the page.
			}
		}
	}
}
