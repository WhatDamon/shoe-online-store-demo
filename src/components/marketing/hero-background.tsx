'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import heroImage from '@/assets/hero-home.webp'

// Landing hero 背景层：静态品牌图 + 可选视频轮播。
// 节奏：静态图停留 6s →（视频已缓存 canplaythrough）交叉淡化 0.8s 到视频播 2.95s → ended 交叉淡化回静态图，无限循环。
// 降级：prefers-reduced-motion / saveData / 慢速蜂窝 → 永不挂 src（零下载），保持静态图；视频失败静默停留静态图。
// 视口：hero 滑出视口即停（回静态图并暂停计时），回到视口重新计时。
// 文字/CTA 由 hero.tsx 叠在此层之上（本组件仅渲染图片 + 视频两层背景）。
// 状态机只由事件/回调驱动（IO、计时器、媒体事件），effect 仅注册订阅 → 无 set-state-in-effect。
// hydration 安全：SSR 与客户端首帧一致渲染「无 src 的 video」（禁播判定在回调内，永不进入渲染层）。

const HERO_VIDEO_SRC = '/videos/hero-a.mp4' // public/ 资产，已剥离音轨
const IMAGE_HOLD_MS = 6000 // 静态图停留时长（设计决策）
// 交叉淡化 800ms（设计决策）——两背景层用静态 Tailwind 类 duration-[800ms]（JIT 需字面量）

type Phase = 'image' | 'video'

function motionDisabled(): boolean {
  if (typeof window === 'undefined') return false
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) return true
  const conn = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection
  if (!conn) return false
  if (conn.saveData === true) return true
  const slow = conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g'
  return slow
}

export function HeroBackground() {
  const [phase, setPhase] = useState<Phase>('image')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const sectionRef = useRef<HTMLDivElement | null>(null)

  // 渲染外可变状态（回调间共享，避免 stale closure / 额外渲染）
  const phaseRef = useRef<Phase>('image')
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readyRef = useRef(false) // 视频已 canplaythrough
  const holdPendingRef = useRef(false) // 计时到点但视频未就绪，就绪后补播
  const srcAttachedRef = useRef(false) // 本轮已挂 src（只挂一次；禁播环境永不为 true）

  const clearHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }

  const toImage = (resetVideo: boolean) => {
    clearHold()
    const v = videoRef.current
    if (resetVideo && v) {
      v.pause()
      v.load() // 丢弃缓冲，回到可重置起点
    }
    holdPendingRef.current = false
    phaseRef.current = 'image'
    setPhase('image')
  }

  const startVideo = () => {
    const v = videoRef.current
    if (!v || !readyRef.current || phaseRef.current !== 'image') return
    clearHold()
    holdPendingRef.current = false
    phaseRef.current = 'video'
    setPhase('video')
    const p = v.play()
    // 播放被意外策略拦截 → 静默回静态图并重新计时，不打扰浏览
    if (p && typeof p.then === 'function') p.catch(() => startImageHold())
  }

  // 静态图停留计时开始；到点且视频就绪 → 播放，否则标记补播等待
  const startImageHold = () => {
    if (phaseRef.current !== 'image') return
    clearHold()
    holdPendingRef.current = false
    holdTimer.current = setTimeout(() => {
      if (readyRef.current && phaseRef.current === 'image') startVideo()
      else holdPendingRef.current = true
    }, IMAGE_HOLD_MS)
  }

  const onVideoCanPlay = () => {
    readyRef.current = true
    // 计时已到点才在等待视频（holdPending）→ 就绪即播；否则由计时器到点触发
    if (holdPendingRef.current && phaseRef.current === 'image') startVideo()
  }

  const onVideoEnded = () => {
    toImage(false)
    startImageHold() // 回到静态图，重新 6s 计时 → 无限循环
  }

  // 视口订阅：进入视口才允许挂载 src 并启动计时；滑出立即停回静态图。
  useEffect(() => {
    const el = sectionRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    let io: IntersectionObserver | null = null
    io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting)
        if (visible) {
          // 禁播环境（reduced-motion/saveData/慢蜂窝）永不挂 src → 视频零下载
          if (!srcAttachedRef.current && !motionDisabled()) {
            const v = videoRef.current
            if (v) {
              v.src = HERO_VIDEO_SRC
              srcAttachedRef.current = true
            }
          }
          startImageHold()
        } else if (phaseRef.current === 'video') {
          toImage(true)
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => {
      io?.disconnect()
      clearHold()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const imgVisible = phase === 'image'
  const videoVisible = phase === 'video'

  return (
    <div ref={sectionRef} className="absolute inset-0">
      <Image
        src={heroImage}
        alt=""
        fill
        priority
        sizes="100vw"
        aria-hidden
        className={`object-cover transition-opacity duration-[800ms] ${imgVisible ? 'opacity-55' : 'opacity-0'}`}
      />
      {/* 装饰视频：aria-hidden 无控件；opacity-55 与静态图一致；禁播环境 src 恒空 → 零下载 */}
      <video
        ref={videoRef}
        aria-hidden
        muted
        playsInline
        preload="auto"
        onCanPlayThrough={onVideoCanPlay}
        onEnded={onVideoEnded}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[800ms] ${
          videoVisible ? 'opacity-55' : 'opacity-0'
        }`}
      />
    </div>
  )
}
