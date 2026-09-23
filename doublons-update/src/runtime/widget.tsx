/** @jsx jsx */
import { React, jsx, type AllWidgetProps } from 'jimu-core'
import { JimuMapViewComponent, type JimuMapView, loadArcGISJSAPIModules } from 'jimu-arcgis'
import { Button, Checkbox, Label, Alert, Loading } from 'jimu-ui'
import type { IMConfig } from '../config'

const { useState, useRef, useEffect, useCallback } = React

const DEFAULT_FIELD = 'Doublons'
const POSITIVE_VALUE = 'OUI'
const NEGATIVE_VALUE = 'NON'
const POSITIVE_LABEL = 'Marquer à supprimer'
const NEGATIVE_LABEL = 'Annuler (remettre NON)'

interface LayerOption {
  key: string
  title: string
  url: string
  geometryType: string // 'polyline' | 'point'
}

interface ArcGISModules {
  FeatureLayer: any
  GraphicsLayer: any
  Graphic: any
}

// Sélection : couche -> (objectId -> graphique)
type SelectionMap = Map<string, Map<number, any>>

export default function Widget(props: AllWidgetProps<IMConfig>) {
  const fieldName = props.config?.fieldName || DEFAULT_FIELD

  const [modules, setModules] = useState<ArcGISModules>(null)
  const [jimuMapView, setJimuMapView] = useState<JimuMapView>(null)
  const [availableLayers, setAvailableLayers] = useState<LayerOption[]>([])
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set())
  const [editableLayers, setEditableLayers] = useState<Map<string, any>>(new Map())
  const [selections, setSelections] = useState<SelectionMap>(new Map())
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingLayers, setLoadingLayers] = useState(false)

  const clickHandleRef = useRef<any>(null)
  const highlightLayerRef = useRef<any>(null)
  // Refs synchronisées pour être lues dans le gestionnaire de clic sans
  // avoir à réabonner l'écouteur à chaque changement de sélection.
  const editableLayersRef = useRef<Map<string, any>>(new Map())
  const selectionsRef = useRef<SelectionMap>(new Map())

  useEffect(() => { editableLayersRef.current = editableLayers }, [editableLayers])
  useEffect(() => { selectionsRef.current = selections }, [selections])

  // -- Chargement différé des modules ArcGIS -------------------------------
  useEffect(() => {
    let cancelled = false
    loadArcGISJSAPIModules([
      'esri/layers/FeatureLayer',
      'esri/layers/GraphicsLayer',
      'esri/Graphic'
    ]).then(([FeatureLayer, GraphicsLayer, Graphic]) => {
      if (!cancelled) setModules({ FeatureLayer, GraphicsLayer, Graphic })
    }).catch((err) => {
      console.error('Erreur de chargement des modules ArcGIS', err)
      setMessage({ text: 'Impossible de charger les modules ArcGIS.', type: 'error' })
    })
    return () => { cancelled = true }
  }, [])

  const onActiveViewChange = (jmv: JimuMapView) => {
    setJimuMapView(jmv)
    setActiveKeys(new Set())
    setEditableLayers(new Map())
    setSelections(new Map())
    if (!jmv) {
      setAvailableLayers([])
      return
    }
    if (highlightLayerRef.current) {
      jmv.view.map.remove(highlightLayerRef.current)
      highlightLayerRef.current = null
    }
  }

  // Crée la couche de surlignage une fois les modules et la vue prêts
  useEffect(() => {
    if (!jimuMapView || !modules) return
    if (!highlightLayerRef.current) {
      const gLayer = new modules.GraphicsLayer({ title: '__doublons_update_highlight__', listMode: 'hide' })
      jimuMapView.view.map.add(gLayer)
      highlightLayerRef.current = gLayer
    }
    discoverEligibleLayers(jimuMapView)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jimuMapView, modules])

  // -- Découverte des couches lignes ET points disponibles ----------------
  const discoverEligibleLayers = async (jmv: JimuMapView) => {
    setLoadingLayers(true)
    const options: LayerOption[] = []
    const allLayers = jmv.view.map.allLayers.toArray()

    const isEligible = (geomType: string) =>
      geomType === 'polyline' || geomType === 'esriGeometryPolyline' ||
      geomType === 'point' || geomType === 'esriGeometryPoint'

    for (const lyr of allLayers) {
      try {
        if (lyr.type === 'feature') {
          await (lyr as any).load()
          const gt = (lyr as any).geometryType
          if (isEligible(gt)) {
            options.push({ key: lyr.id, title: (lyr as any).title, url: (lyr as any).url, geometryType: gt })
          }
        } else if (lyr.type === 'map-image') {
          await (lyr as any).load()
          const mapImageLayer: any = lyr
          const subs = (mapImageLayer.allSublayers || mapImageLayer.sublayers).toArray()
          for (const sub of subs) {
            try {
              await sub.load()
              const geomType = sub.geometryType || sub.sourceJSON?.geometryType
              if (isEligible(geomType)) {
                options.push({
                  key: `${mapImageLayer.id}-${sub.id}`,
                  title: sub.title,
                  url: `${mapImageLayer.url}/${sub.id}`,
                  geometryType: geomType
                })
              }
            } catch (e) { /* sous-couche non chargeable -> ignorée */ }
          }
        }
      } catch (e) { /* couche non chargeable -> ignorée */ }
    }

    setAvailableLayers(options)
    setLoadingLayers(false)
  }

  // -- Coche / décoche une couche dans la liste multi-sélection -----------
  const toggleLayerActive = async (opt: LayerOption, checked: boolean) => {
    if (!modules) return
    setMessage(null)

    if (checked) {
      const fl = new modules.FeatureLayer({ url: opt.url, outFields: ['*'] })
      await fl.load()
      setEditableLayers((prev) => {
        const next = new Map(prev)
        next.set(opt.key, fl)
        return next
      })
      setActiveKeys((prev) => new Set(prev).add(opt.key))
    } else {
      setEditableLayers((prev) => {
        const next = new Map(prev)
        next.delete(opt.key)
        return next
      })
      setActiveKeys((prev) => {
        const next = new Set(prev)
        next.delete(opt.key)
        return next
      })
      setSelections((prev) => {
        const next = new Map(prev)
        next.delete(opt.key)
        refreshHighlight(next)
        return next
      })
    }
  }

  const clearSelection = useCallback(() => {
    const empty: SelectionMap = new Map()
    setSelections(empty)
    if (highlightLayerRef.current) {
      highlightLayerRef.current.removeAll()
    }
  }, [])

  const refreshHighlight = useCallback((sel: SelectionMap) => {
    if (!highlightLayerRef.current || !modules) return
    highlightLayerRef.current.removeAll()
    sel.forEach((featMap) => {
      featMap.forEach((g) => {
        const isPoint = g.geometry?.type === 'point'
        highlightLayerRef.current.add(
          new modules.Graphic({
            geometry: g.geometry,
            symbol: isPoint
              ? { type: 'simple-marker', color: [255, 0, 0, 0.9], size: 12, outline: { color: [255, 255, 255], width: 1 } }
              : { type: 'simple-line', color: [255, 0, 0, 1], width: 4 }
          })
        )
      })
    })
  }, [modules])

  // -- Clic sur la carte : interroge chaque couche active, tour à tour, --
  // -- et bascule le premier hit trouvé (ligne ou point) dans la sélection --
  useEffect(() => {
    if (clickHandleRef.current) {
      clickHandleRef.current.remove()
      clickHandleRef.current = null
    }
    if (!jimuMapView) return

    clickHandleRef.current = jimuMapView.view.on('click', async (evt: any) => {
      const currentLayers = editableLayersRef.current
      if (currentLayers.size === 0) return
      evt.stopPropagation()
      setMessage(null)

      const tolerance = jimuMapView.view.resolution * 6

      for (const [key, layer] of currentLayers.entries()) {
        try {
          const query = layer.createQuery()
          query.geometry = evt.mapPoint
          query.distance = tolerance
          query.units = 'meters'
          query.spatialRelationship = 'intersects'
          query.outFields = ['*']
          query.returnGeometry = true
          query.num = 1

          const result = await layer.queryFeatures(query)
          if (!result.features.length) continue

          const graphic = result.features[0]
          const oidField = layer.objectIdField
          const oid = graphic.attributes[oidField]

          setSelections((prev) => {
            const next = new Map(prev)
            const layerSel = new Map(next.get(key) || new Map())
            if (layerSel.has(oid)) {
              layerSel.delete(oid)
            } else {
              layerSel.set(oid, graphic)
            }
            next.set(key, layerSel)
            refreshHighlight(next)
            return next
          })
          // Un seul hit par clic : on s'arrête à la première couche qui répond
          break
        } catch (err) {
          console.error('Erreur de requête au clic sur', key, err)
        }
      }
    })

    return () => {
      if (clickHandleRef.current) {
        clickHandleRef.current.remove()
        clickHandleRef.current = null
      }
    }
  }, [jimuMapView, refreshHighlight])

  const totalSelectedCount = Array.from(selections.values()).reduce((sum, m) => sum + m.size, 0)

  // -- Mise à jour attributaire, couche par couche -------------------------
  const handleUpdate = async (value: string) => {
    if (totalSelectedCount === 0) return
    setBusy(true)
    setMessage(null)

    let totalUpdated = 0
    let totalErrors = 0

    for (const [key, featMap] of selections.entries()) {
      if (featMap.size === 0) continue
      const layer = editableLayers.get(key)
      if (!layer) continue
      const oidField = layer.objectIdField
      const updates = Array.from(featMap.keys()).map((oid) => ({
        attributes: {
          [oidField]: oid,
          [fieldName]: value
        }
      }))
      try {
        const result = await layer.applyEdits({ updateFeatures: updates })
        const errors = (result.updateFeatureResults || []).filter((r: any) => r.error)
        totalUpdated += updates.length - errors.length
        totalErrors += errors.length
        if (errors.length > 0) console.error('Erreurs applyEdits sur', key, errors)
      } catch (err) {
        console.error('Erreur applyEdits sur', key, err)
        totalErrors += updates.length
      }
    }

    if (totalErrors > 0) {
      setMessage({ text: `${totalUpdated} entité(s) mise(s) à jour, ${totalErrors} en erreur.`, type: totalUpdated > 0 ? 'success' : 'error' })
    } else {
      setMessage({ text: `${totalUpdated} entité(s) mise(s) à jour : ${fieldName} = ${value}.`, type: 'success' })
    }
    if (totalErrors === 0) clearSelection()
    setBusy(false)
  }

  return (
    <div className="widget-doublons-update p-3" style={{ overflow: 'auto', height: '100%' }}>
      <style>{`
        .widget-doublons-update .doublons-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .widget-doublons-update .doublons-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border: none;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 600;
          line-height: 1;
          cursor: pointer;
          color: #fff;
          box-shadow: 0 1px 2px rgba(0,0,0,0.15);
          transition: background-color 0.15s ease, box-shadow 0.15s ease, transform 0.05s ease;
        }
        .widget-doublons-update .doublons-btn__icon {
          font-size: 14px;
          line-height: 1;
        }
        .widget-doublons-update .doublons-btn:hover:not(:disabled) {
          box-shadow: 0 2px 6px rgba(0,0,0,0.22);
        }
        .widget-doublons-update .doublons-btn:active:not(:disabled) {
          transform: translateY(1px);
        }
        .widget-doublons-update .doublons-btn:disabled {
          cursor: not-allowed;
          opacity: 0.45;
          box-shadow: none;
        }
        .widget-doublons-update .doublons-btn--mark {
          background-color: #d9534f;
        }
        .widget-doublons-update .doublons-btn--mark:hover:not(:disabled) {
          background-color: #c9302c;
        }
        .widget-doublons-update .doublons-btn--reset {
          background-color: #5a9fd4;
        }
        .widget-doublons-update .doublons-btn--reset:hover:not(:disabled) {
          background-color: #4a8ec4;
        }
        .widget-doublons-update .doublons-btn--clear {
          background-color: #6c757d;
        }
        .widget-doublons-update .doublons-btn--clear:hover:not(:disabled) {
          background-color: #5a6268;
        }
      `}</style>

      {props.useMapWidgetIds && props.useMapWidgetIds.length === 1 && (
        <JimuMapViewComponent
          useMapWidgetId={props.useMapWidgetIds[0]}
          onActiveViewChange={onActiveViewChange}
        />
      )}

      {(!props.useMapWidgetIds || props.useMapWidgetIds.length === 0) && (
        <Alert type="warning" withIcon text="Associez d'abord ce widget à un widget Carte (panneau de propriétés, à droite)." />
      )}

      {!modules && <p><em>Chargement des modules ArcGIS…</em></p>}

      <p className="mb-1"><strong>1.</strong> Cochez une ou plusieurs couches à traiter :</p>
      {loadingLayers && <p><em>Recherche des couches…</em></p>}
      {!loadingLayers && modules && availableLayers.length === 0 && jimuMapView && (
        <p className="text-warning"><em>Aucune couche de lignes ou de points détectée.</em></p>
      )}
      <div>
        {availableLayers.map((opt) => (
          <div key={opt.key} className="mb-1">
            <Label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <Checkbox
                checked={activeKeys.has(opt.key)}
                onChange={(e) => toggleLayerActive(opt, (e.target as HTMLInputElement).checked)}
                disabled={!modules}
              />
              <span className="ml-1">
                {opt.title} <em style={{ opacity: 0.6 }}>({opt.geometryType === 'point' ? 'points' : 'lignes'})</em>
              </span>
            </Label>
          </div>
        ))}
      </div>

      <p className="mt-3 mb-1">
        <strong>2.</strong> Cliquez sur les entités dans la carte pour les sélectionner
        (recliquer pour désélectionner). Fonctionne sur toutes les couches cochées à la fois.
      </p>

      <p>
        <strong>{totalSelectedCount}</strong> entité(s) sélectionnée(s) au total
      </p>

      <div className="doublons-actions mt-3">
        <button
          type="button"
          className="doublons-btn doublons-btn--mark"
          disabled={totalSelectedCount === 0 || busy}
          onClick={() => handleUpdate(POSITIVE_VALUE)}
        >
          <span className="doublons-btn__icon" aria-hidden="true"></span>
          <span>{busy ? 'Mise à jour…' : POSITIVE_LABEL}</span>
        </button>

        <button
          type="button"
          className="doublons-btn doublons-btn--reset"
          disabled={totalSelectedCount === 0 || busy}
          onClick={() => handleUpdate(NEGATIVE_VALUE)}
        >
          <span className="doublons-btn__icon" aria-hidden="true"></span>
          <span>{busy ? 'Mise à jour…' : NEGATIVE_LABEL}</span>
        </button>

        <button
          type="button"
          className="doublons-btn doublons-btn--clear"
          disabled={totalSelectedCount === 0 || busy}
          onClick={clearSelection}
        >
          <span className="doublons-btn__icon" aria-hidden="true"></span>
          <span>Effacer la sélection</span>
        </button>
      </div>

      {busy && <Loading className="mt-2" />}

      {message && (
        <Alert
          className="mt-3"
          type={message.type}
          withIcon
          text={message.text}
        />
      )}
    </div>
  )
}
