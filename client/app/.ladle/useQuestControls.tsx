import { useEffect } from "react"

import { button, folder, useControls } from "leva"

import useGameStore from "@/stores/game"

import {
  MOCK_QUEST_LIST,
  MOCK_QUEST_STEPS,
  MOCK_TUTORIAL_CORPS_QUEST,
  MOCK_TUTORIAL_CORPS_STEPS,
} from "@/mocks/quest.mock"

const STEPS_BY_CODE: Record<string, QuestStep[]> = {
  tutorial: MOCK_QUEST_STEPS,
  tutorial_corporations: MOCK_TUTORIAL_CORPS_STEPS,
}

// Reward credits per step, keyed by quest code → step_index
const STEP_REWARDS: Record<string, Record<number, number>> = {
  tutorial: { 1: 50, 2: 100, 3: 75, 4: 100, 5: 500, 6: 1000, 7: 250 },
  tutorial_corporations: { 1: 500, 2: 1000 },
}

export const useQuestControls = () => {
  const quests = useGameStore.use.quests()
  const setQuests = useGameStore.use.setQuests()
  const updateQuestStepCompleted = useGameStore.use.updateQuestStepCompleted()
  const completeQuest = useGameStore.use.completeQuest()
  const setQuestCompletionData = useGameStore.use.setQuestCompletionData()
  const setNotifications = useGameStore.use.setNotifications()

  const activeQuests = quests.filter((q) => q.status === "active")
  const questOptions = activeQuests.reduce(
    (acc, q) => ({ ...acc, [q.name]: q.quest_id }),
    {} as Record<string, string>
  )
  const hasOptions = Object.keys(questOptions).length > 0

  const [values, set] = useControls(
    () => ({
      Quests: folder(
        {
          ["Load Mock"]: button(() => {
            setQuests(MOCK_QUEST_LIST)
          }),
          ["Add Second"]: button(() => {
            const existing = quests.find((q) => q.code === "tutorial_corporations")
            if (existing) return
            setQuests([...quests, MOCK_TUTORIAL_CORPS_QUEST])
          }),
          ["Active Quest"]: {
            value: activeQuests[0]?.quest_id ?? "",
            options: hasOptions ? questOptions : { "(none)": "" },
          },
          ["Step Forward"]: button((get) => {
            const questId = get("Quests.Active Quest")
            const quest = quests.find((q) => q.quest_id === questId)
            if (!quest?.current_step) return

            const steps = STEPS_BY_CODE[quest.code] ?? []
            const nextMockStep = steps.find(
              (s) => s.step_index === quest.current_step.step_index + 1
            )

            const rewardCredits = STEP_REWARDS[quest.code]?.[quest.current_step.step_index]
            updateQuestStepCompleted(quest.quest_id, quest.current_step.step_index, nextMockStep)
            setQuestCompletionData({
              type: "step",
              questName: quest.name,
              completedStepName: quest.current_step.name,
              nextStep: nextMockStep ?? quest.current_step,
              reward: rewardCredits ? { credits: rewardCredits } : undefined,
            })
            setNotifications({ questCompleted: true })
          }),
          ["Quest Complete"]: button((get) => {
            const questId = get("Quests.Active Quest")
            const quest = quests.find((q) => q.quest_id === questId)
            if (!quest) return
            const lastStepIndex = (STEPS_BY_CODE[quest.code] ?? []).length
            const rewardCredits = STEP_REWARDS[quest.code]?.[lastStepIndex]
            setQuestCompletionData({
              type: "quest",
              completedQuestName: quest.name,
              snapshotQuestIds: [],
              reward: rewardCredits ? { credits: rewardCredits } : undefined,
            })
            completeQuest(quest.quest_id)
            setNotifications({ questCompleted: true })
          }),
          ["Reset"]: button(() => {
            setQuests([])
          }),
        },
        { collapsed: true }
      ),
    }),
    [quests]
  )

  useEffect(() => {
    const currentSelection = values["Active Quest"]
    const isValid = activeQuests.some((q) => q.quest_id === currentSelection)
    if (!isValid) {
      set({ "Active Quest": activeQuests[0]?.quest_id ?? "" })
    }
  }, [quests])

  return [values, set]
}
