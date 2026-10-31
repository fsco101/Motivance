package com.motivance.feature.rehabilitation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.motivance.domain.*
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HistoryState(
    val owner: String = "", val query: HistoryQuery? = null,
    val rows: List<HistoricalSession> = emptyList(), val next: HistoryCursor? = null,
    val loading: Boolean = false, val failed: Boolean = false, val loaded: Boolean = false,
)

@HiltViewModel
class HistoryViewModel @Inject constructor(private val repository: RehabilitationRepository) : ViewModel() {
    private val mutable = MutableStateFlow(HistoryState())
    val state = mutable.asStateFlow()
    private var request: Job? = null
    private var generation = 0L

    fun configure(owner: String?) {
        if (owner.orEmpty() == mutable.value.owner) return
        generation++
        request?.cancel()
        mutable.value = HistoryState(owner = owner.orEmpty())
    }

    fun show(query: HistoryQuery) {
        if (query == mutable.value.query && (mutable.value.loaded || mutable.value.loading)) return
        fetch(query, append = false)
    }

    fun refresh() { mutable.value.query?.let { fetch(it, append = false) } }
    fun loadOlder() {
        val current = mutable.value
        if (!current.loading && current.next != null) current.query?.let { fetch(it, append = true) }
    }

    private fun fetch(query: HistoryQuery, append: Boolean) {
        val current = mutable.value
        if (current.owner.isBlank()) return
        val ticket = ++generation
        request?.cancel()
        // A refresh clears earlier health data; failed authorization never leaves stale results visible.
        mutable.value = if (append) current.copy(loading = true, failed = false)
            else HistoryState(owner = current.owner, query = query, loading = true)
        request = viewModelScope.launch {
            try {
                val page = repository.loadHistory(query, if (append) current.next else null)
                if (generation == ticket) mutable.value = mutable.value.copy(
                    rows = ((if (append) current.rows else emptyList()) + page.sessions).distinctBy { it.id },
                    next = page.next, loading = false, loaded = true)
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) {
                if (generation == ticket) mutable.value = HistoryState(owner = current.owner, query = query, failed = true)
            }
        }
    }
}
