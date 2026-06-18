;(async () => {
  const statusText = document.getElementById('status-text')
  const arButton = document.getElementById('ar-button')
  const video = document.getElementById('video')

  const setStatus = (t) => { if (statusText) statusText.textContent = t }

  if (typeof THREE === 'undefined') { setStatus('Three.js 載入失敗'); return }

  // ── Decide path: WebXR vs Desktop ──
  const webXRAvailable = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')

  if (webXRAvailable) {
    arButton.style.display = 'block'
    setStatus('點擊下方按鈕啟動 AR')
    arButton.addEventListener('click', startWebXR)
    arButton.addEventListener('touchend', (e) => { e.preventDefault(); startWebXR() })
  } else {
    if (arButton) arButton.style.display = 'none'
    setStatus('正在啟動桌面模式…')
    setTimeout(startDesktop, 100)
  }

  // ═══════════════════════════════════════════════
  //  SHARED
  // ═══════════════════════════════════════════════

  const planeFillMat = new THREE.MeshBasicMaterial({
    color: 0x00FF88, transparent: true, opacity: 0.15,
    side: THREE.DoubleSide, depthWrite: false,
  })
  const planeBorderMat = new THREE.LineBasicMaterial({
    color: 0x00FF88, transparent: true, opacity: 0.50,
  })

  function createMonster() {
    const g = new THREE.Group()

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6B3FA0, roughness: 0.5, metalness: 0.1 })
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0x9B6FC0, roughness: 0.6 })
    const hornMat = new THREE.MeshStandardMaterial({ color: 0xE8D060, roughness: 0.3 })
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.1 })
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.0 })

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), bodyMat)
    body.position.y = 0.08; body.scale.set(1.2, 0.9, 0.8)
    g.add(body)

    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), bellyMat)
    belly.position.set(0, 0.06, 0.05); belly.scale.set(1.0, 0.6, 0.6)
    g.add(belly)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), bodyMat)
    head.position.set(0, 0.13, 0.06); head.scale.set(0.9, 0.8, 0.8)
    g.add(head)

    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), eyeMat)
      eye.position.set(s * 0.018, 0.14, 0.085); g.add(eye)
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 4), pupilMat)
      pupil.position.set(s * 0.018, 0.14, 0.098); g.add(pupil)
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.025, 6), hornMat)
      horn.position.set(s * 0.02, 0.17, 0.04)
      horn.rotation.x = -0.25; horn.rotation.z = s * 0.25
      g.add(horn)
    }

    const legMat = new THREE.MeshStandardMaterial({ color: 0x5A3080, roughness: 0.6 })
    for (const [dx, dz] of [[-0.04, -0.04], [0.04, -0.04], [-0.035, 0.05], [0.035, 0.05]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.045, 6), legMat)
      leg.position.set(dx, 0.022, dz); g.add(leg)
    }

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.055, 6), bodyMat)
    tail.position.set(0, 0.06, -0.08); tail.rotation.x = 0.4
    g.add(tail)

    g.visible = false
    return g
  }

  function placeMonster(monsterObj, pos, quat) {
    if (!monsterObj) return
    monsterObj.position.copy(pos)
    if (quat) monsterObj.quaternion.copy(quat)
    const yaw = (Math.random() - 0.5) * 0.5
    monsterObj.rotateY(yaw)
    monsterObj.visible = true
    setStatus('怪物已放置！👾')
  }

  function buildPlaneMesh(polygon, pose, refSpace) {
    const N = polygon.length
    if (N < 3) return null
    const g = new THREE.Group()
    g.position.copy(pose.transform.position)
    g.quaternion.copy(pose.transform.orientation)

    const raw = []
    for (const p of polygon) raw.push(new THREE.Vector3(p.x, p.y, p.z))
    const cent = new THREE.Vector3()
    for (const p of raw) cent.add(p)
    cent.divideScalar(N)
    const local = raw.map(p => p.clone().sub(cent))
    const wc = cent.clone().applyQuaternion(pose.transform.orientation)
    g.position.add(wc)

    const verts = [0, 0, 0]
    for (const p of local) verts.push(p.x, p.y, p.z)
    const idx = []
    for (let i = 1; i <= N; i++) idx.push(0, i, i % N + 1)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geo.setIndex(idx); geo.computeVertexNormals()
    const fill = new THREE.Mesh(geo, planeFillMat)
    fill.renderOrder = 0; g.add(fill)

    const bp = [...local, local[0]]
    const bgeo = new THREE.BufferGeometry().setFromPoints(bp)
    const border = new THREE.Line(bgeo, planeBorderMat)
    border.renderOrder = 1; g.add(border)
    return g
  }

  // ═══════════════════════════════════════════════
  //  DESKTOP FALLBACK
  // ═══════════════════════════════════════════════

  async function startDesktop() {
    // Start webcam
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      video.srcObject = stream
      video.style.display = 'block'
      await video.play()
    } catch (_) {
      setStatus('相機啟動失敗，仍可使用滑鼠操作')
    }

    if (video.videoWidth === 0) {
      await new Promise(r => { video.onloadedmetadata = r; setTimeout(r, 3000) })
    }

    const W = window.innerWidth, H = window.innerHeight

    // Three.js
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100)
    camera.position.set(0, 1.5, 4)

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.style.cssText = 'position:fixed;top:0;left:0;z-index:5'
    document.body.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(2, 3, 1)
    scene.add(dl)
    scene.add(new THREE.AmbientLight(0x8888ff, 0.3))

    // Monster
    const monster = createMonster()
    scene.add(monster)

    // Shadow ring
    const shadowRing = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.09, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
    )
    shadowRing.geometry.rotateX(-Math.PI / 2)
    shadowRing.visible = false
    scene.add(shadowRing)

    // Virtual ground for raycasting
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()

    // Click to place
    function onPlaceClick(e) {
      const ww = window.innerWidth, wh = window.innerHeight
      mouse.x = (e.clientX / ww) * 2 - 1
      mouse.y = -(e.clientY / wh) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const pt = new THREE.Vector3()
      raycaster.ray.intersectPlane(groundPlane, pt)
      if (pt) {
        placeMonster(monster, pt, new THREE.Quaternion())
        shadowRing.position.copy(pt)
        shadowRing.visible = true
      }
    }
    renderer.domElement.addEventListener('click', onPlaceClick)

    // Camera orbit (mouse drag)
    let theta = 0, phi = 0
    const radius = 4
    let dragging = false, lx = 0, ly = 0

    renderer.domElement.addEventListener('mousedown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY })
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return
      theta += (e.clientX - lx) * 0.008
      phi += (e.clientY - ly) * 0.008
      phi = Math.max(-0.8, Math.min(0.8, phi))
      lx = e.clientX; ly = e.clientY
    })
    window.addEventListener('mouseup', () => { dragging = false })

    function updateCamera() {
      camera.position.x = radius * Math.sin(theta) * Math.cos(phi)
      camera.position.y = 1.5 + radius * Math.sin(phi)
      camera.position.z = radius * Math.cos(theta) * Math.cos(phi)
      camera.lookAt(0, 0.2, 0)
    }

    setStatus('點擊畫面放置怪物 👾  拖曳旋轉查看')

    // Render loop
    let lastTime = 0
    renderer.setAnimationLoop((timestamp) => {
      const dt = Math.min((timestamp - lastTime) / 1000, 0.05)
      lastTime = timestamp

      updateCamera()
      if (monster.visible) {
        monster.position.y += Math.sin(timestamp * 0.003) * 0.0004
        monster.rotation.y += 0.002
        shadowRing.position.y = monster.position.y - 0.005
      }
      renderer.render(scene, camera)
    })

    // Resize (update W/H reference)
    window.addEventListener('resize', () => {
      const w = window.innerWidth, h = window.innerHeight
      camera.aspect = w / h; camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
  }

  // ═══════════════════════════════════════════════
  //  WEBXR
  // ═══════════════════════════════════════════════

  async function startWebXR() {
    let session
    try {
      session = await navigator.xr.requestSession('immersive-ar', {
        optionalFeatures: ['plane-detection', 'hit-test'],
      })
    } catch (err) {
      setStatus('啟動 AR 失敗：' + (err.message || ''))
      arButton.style.display = 'block'
      arButton.textContent = '重試'
      return
    }

    arButton.style.display = 'none'
    setStatus('AR 已啟動')

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.xr.enabled = true
    document.body.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = null
    const camera = new THREE.PerspectiveCamera()
    camera.matrixAutoUpdate = false

    scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(2, 3, 1)
    scene.add(dl)
    scene.add(new THREE.AmbientLight(0x8888ff, 0.3))

    try {
      await renderer.xr.setSession(session)
    } catch (xrErr) {
      hint.textContent = 'XR 設定失敗: ' + xrErr.message
      hint.classList.add('visible')
      return
    }
    renderer.setClearColor(0x000000, 0)

    const reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.08, 24),
      new THREE.MeshBasicMaterial({ color: 0x00FF88, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    )
    reticle.geometry.rotateX(-Math.PI / 2)
    reticle.visible = false
    scene.add(reticle)

    const monster = createMonster()
    scene.add(monster)

    // Debug: red cube at origin (visible immediately, no hit test needed)
    const debugCube = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    )
    debugCube.position.set(0, 0, -1.5)
    scene.add(debugCube)

    const hint = document.createElement('div')
    hint.id = 'ar-hint'
    hint.textContent = '點擊畫面放置怪物 👾'
    document.body.appendChild(hint)

    let hitTestSource = null
    let vs
    try {
      vs = await session.requestReferenceSpace('viewer')
    } catch (_) {}
    if (vs) {
      try {
        hitTestSource = await session.requestHitTestSource({ space: vs, entityTypes: ['plane'] })
      } catch (_) {
        try {
          hitTestSource = await session.requestHitTestSource({ space: vs })
        } catch (_2) {}
      }
    }

    let pendingPlace = false
    let sessionEnded = false
    const planeMeshes = new Map()

    session.addEventListener('select', () => { pendingPlace = true })
    session.addEventListener('end', () => { sessionEnded = true; hint.remove(); setStatus('AR 已結束') })

    window.addEventListener('resize', () => renderer.setSize(window.innerWidth, window.innerHeight))
    setTimeout(() => hint.classList.add('visible'), 2000)

    function updatePlanes(frame, refSpace) {
      const detected = frame.detectedPlanes
      if (!detected) return
      for (const [plane, data] of planeMeshes) {
        if (!detected.has(plane)) {
          scene.remove(data.group); data.group.traverse(c => { if (c.geometry) c.geometry.dispose() })
          planeMeshes.delete(plane)
        }
      }
      for (const plane of detected) {
        const pose = frame.getPose(plane.planeSpace, refSpace)
        if (!pose) continue
        const poly = plane.polygon
        if (!poly || poly.length < 3) continue
        const existing = planeMeshes.get(plane)
        if (existing && existing.lastChangedTime === plane.lastChangedTime) continue
        if (existing) { scene.remove(existing.group); existing.group.traverse(c => { if (c.geometry) c.geometry.dispose() }) }
        const mesh = buildPlaneMesh(poly, pose, refSpace)
        if (mesh) { scene.add(mesh); planeMeshes.set(plane, { group: mesh, lastChangedTime: plane.lastChangedTime }) }
      }
    }

    let frameCount = 0
    function onXRFrame(time, frame) {
      session.requestAnimationFrame(onXRFrame)

      frameCount++
      hint.textContent = 'AR frame:' + frameCount
      hint.classList.add('visible')

      const refSpace = renderer.xr.getReferenceSpace()
      if (!frame || !refSpace) { return }

      updatePlanes(frame, refSpace)

      if (hitTestSource) {
        const results = frame.getHitTestResults(hitTestSource)
        let hit = false
        if (results && results.length > 0) {
          const pose = results[0].getPose(refSpace)
          if (pose) {
            reticle.position.copy(pose.transform.position)
            reticle.quaternion.copy(pose.transform.orientation)
            reticle.visible = true; hit = true
            if (pendingPlace) {
              placeMonster(monster, pose.transform.position, pose.transform.orientation)
              pendingPlace = false; hint.classList.remove('visible')
              hint.textContent = '怪物已放置！'
              hint.classList.add('visible')
            }
          }
        }
        if (!hit) reticle.visible = false
      }

      if (pendingPlace && !hitTestSource) {
        pendingPlace = false
        const vp = frame.getViewerPose(refSpace)
        if (vp) {
          const pos = vp.transform.position.clone()
          const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(vp.transform.orientation)
          dir.y = 0; dir.normalize()
          pos.add(dir.multiplyScalar(1.5)); pos.y = 0
          const q = new THREE.Quaternion()
          q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().negate())
          placeMonster(monster, pos, q)
        }
        hint.classList.remove('visible')
      }

      if (monster.visible) {
        monster.position.y += Math.sin(time * 0.003) * 0.0004
        monster.rotation.y += 0.002
      }
      renderer.render(scene, camera)
    }
    session.requestAnimationFrame(onXRFrame)
  }
})()
