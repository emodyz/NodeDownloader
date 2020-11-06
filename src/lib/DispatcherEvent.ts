export default class DispatcherEvent {
  eventName: string;
  callbacks: any[];

  constructor(eventName: string) {
    this.eventName = eventName;
    this.callbacks = [];
  }

  registerCallback(callback: (data) => void) {
    this.callbacks.push(callback);
  }

  unregisterCallback(callback: (data) => void) {
    const index = this.callbacks.indexOf(callback);
    if (index > -1) {
      this.callbacks.splice(index, 1);
    }
  }

  fire(data: any) {
    const callbacks = this.callbacks.slice(0);

    callbacks.forEach((callback) => {
      callback(data);
    });
  }
}
