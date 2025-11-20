export function createMapBridge({ onSelect } = {}) {
  const modal = document.getElementById('mapModal');
  const closeBtn = document.getElementById('closeMap');
  const iframe = document.getElementById('mapFrame');
  let pendingInit = null;

  closeBtn?.addEventListener('click', close);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) {
      close();
    }
  });

  if (iframe) {
    iframe.addEventListener('load', () => {
      if (pendingInit) {
        postInitMessage(pendingInit);
        pendingInit = null;
      }
    });
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'locationSelected') {
      if (typeof data.lat === 'number' && typeof data.lng === 'number') {
        onSelect?.({ lat: data.lat, lng: data.lng, address: data.address });
      }
      close();
    }
    if (data.type === 'locationCancelled') {
      close();
    }
  });

  return { open };

  function open(initialLocation = {}) {
    if (modal) {
      modal.classList.remove('hidden');
    }
    if (iframe?.contentWindow) {
      postInitMessage(initialLocation);
    } else {
      pendingInit = initialLocation;
    }
  }

  function close() {
    modal?.classList.add('hidden');
  }

  function postInitMessage(location) {
    if (!iframe?.contentWindow) return;
    const { lat = null, lng = null, address = null } = location || {};
    iframe.contentWindow.postMessage({
      type: 'initLocation',
      lat,
      lng,
      address
    }, '*');
  }
}
