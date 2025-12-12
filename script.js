(() => {
	// Basic constants and state
	const SUITS = ['♠','♥','♦','♣'];
	const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
	let deck = [];
	let community = [];
	// seats: 0 = AI1, 1 = AI2, 2 = Player
	let seats = [{name:'AI 1',hand:[]},{name:'AI 2',hand:[]},{name:'You',hand:[]}];
	let pot = 0;
	let currentBet = 0;
	let ended = true; // whether hand is finished

	const AI_NAMES = [
		"Raven","Marlowe","Dex","Ivy","Baxter","Nova","Kai","Luna","Orion","Sable",
		"Rico","Echo","Vega","Atlas","Sylas","Faye","Juno","Cedar","Nyx","Blair",
		"Zeke","Mira","Hale","Rowan","Tess","Gage","Aria","Quinn","Leif","Skye"
	];

	// DOM helpers
	const $ = sel => document.querySelector(sel);
	const $$ = sel => Array.from(document.querySelectorAll(sel));

	// Deck helpers
	function rankValue(r){ if(r==='A') return 14; if(r==='K') return 13; if(r==='Q') return 12; if(r==='J') return 11; return parseInt(r); }
	function buildDeck(){ deck = []; for(const s of SUITS) for(const r of RANKS) deck.push({rank:r,suit:s,value:rankValue(r)}); updateDeckCount(); }
	function shuffle(){ for(let i=deck.length-1;i>0;i--){ let j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; } updateDeckCount(); }
	function draw(){ const c = deck.pop(); updateDeckCount(); return c; }
	function updateDeckCount(){ const el = $('#deck-count'); if(el) el.textContent = deck.length; }

	// Rendering cards
	function renderCardEl(card){
		if(!card) return createBack();
		const el = document.createElement('div');
		el.className = 'card ' + ((card.suit==='♥' || card.suit==='♦') ? 'red' : 'black');
		el.innerHTML = `<div class="corner">${card.rank}<span class="suit">${card.suit}</span></div><div class="suit-center">${card.suit}</div>`;
		return el;
	}
	function createBack(){ const el=document.createElement('div'); el.className='card back'; el.textContent='♣'; return el; }

	// HUD and table
	function clearTable(){
		community = [];
		$$('.card-slot').forEach(s=>s.innerHTML='');
		$$('.seat .hand').forEach(h=>h.innerHTML='');
		$('#player-hand').innerHTML='';
		$$('.seat').forEach(el=>el.classList.remove('winner'));
		$('#player-hand').classList.remove('winner');
	}
	function updateHUD(){
		$('#pot').textContent = pot;
		const youStackEl = $('#you-stack') || $('#player-stack');
		if(youStackEl) youStackEl.textContent = seats[2].stack ?? 1000;
		$$('.stack-amt').forEach((el,i)=> el.textContent = seats[i].stack ?? 1000);
		$('#to-call').textContent = Math.max(0, currentBet - (seats[2].contributed || 0));
		updateDeckCount();
	}

	// Name assignment (once per page load)
	function assignAINames(){
		const pool = AI_NAMES.slice();
		const pick = () => pool.splice(Math.floor(Math.random()*pool.length),1)[0];
		seats[0].name = pick();
		seats[1].name = pick();
		const s0 = document.querySelector('#seat-1 .name');
		const s1 = document.querySelector('#seat-2 .name');
		if(s0) s0.textContent = seats[0].name;
		if(s1) s1.textContent = seats[1].name;
	}

	// Betting helpers
	function resetBettingRound(){
		for(const s of seats){ s.contributed = 0; s.folded = false; s.raiseCount = 0; }
		currentBet = 0;
		updateHUD();
	}
	// allow betting anytime while hand is active: enable/disable based on ended/folded/raise limits/stack
	function enablePlayerActions(/* optional */force){
		// if force === true/false provided, use it (backwards compat), otherwise compute from state
		const active = (typeof force === 'boolean') ? force && !ended && !seats[2].folded : (!ended && !seats[2].folded);
		$('#check-call').disabled = !active || (seats[2].stack <= 0);
		$('#allin-btn').disabled = !active || (seats[2].stack <= 0);
		const rDisabled = !active || ((seats[2].raiseCount||0) >= 2) || (seats[2].stack<=0);
		$('#raise-btn').disabled = rDisabled;
		// fold should be available whenever a hand is active and player hasn't folded
		$('#fold-btn').disabled = ended || !!seats[2].folded;
	}
	function startNewHandDisabled(flag){ $('#new-hand').disabled = flag; }

	// Async AI resolver to keep UI responsive. AI will not raise more than 2 times per round.
	function resolveAIActionsAsync(onComplete){
		let tick = 0;
		function step(){
			tick++;
			let anyChange = false;
			for(let idx=0; idx<2; idx++){
				const seat = seats[idx];
				if(seat.folded) continue;
				const toCall = Math.max(0, currentBet - (seat.contributed||0));
				const strength = getHandStrength(idx);
				const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
				if(toCall === 0){
					// No bet to call: check or raise
					let raiseProb = 0;
					if(strength > 0.8) raiseProb = 0.8;
					else if(strength > 0.6) raiseProb = 0.4;
					else if(strength > 0.4) raiseProb = 0.1;
					if((seat.raiseCount||0) < 2 && Math.random() < raiseProb && seat.stack > 20){
						const raiseAmount = Math.min(seat.stack, 20 + Math.floor(Math.random()*80));
						seat.stack -= raiseAmount;
						seat.contributed += raiseAmount;
						currentBet = Math.max(currentBet, seat.contributed);
						pot += raiseAmount;
						seat.raiseCount = (seat.raiseCount||0) + 1;
						anyChange = true;
					}
				} else {
					// Facing a bet: fold, call, or raise
					let callProb = 0, raiseProb = 0;
					if(strength > 0.8) {
						callProb = 1.0;
						raiseProb = 0.6;
					} else if(strength > 0.6) {
						callProb = 0.9;
						raiseProb = 0.2;
					} else if(strength > 0.5) {
						callProb = 0.7;
						if(potOdds < 0.3) raiseProb = 0.1;
					} else if(strength > 0.3) {
						callProb = 0.4;
					} else {
						callProb = 0.1;
					}
					if(Math.random() < raiseProb && (seat.raiseCount||0) < 2 && seat.stack > toCall + 20){
						const raiseAmount = Math.min(seat.stack - toCall, 20 + Math.floor(Math.random()*80));
						seat.stack -= (toCall + raiseAmount);
						seat.contributed += (toCall + raiseAmount);
						currentBet = Math.max(currentBet, seat.contributed);
						pot += (toCall + raiseAmount);
						seat.raiseCount = (seat.raiseCount||0) + 1;
						anyChange = true;
					} else if(Math.random() < callProb){
						const pay = Math.min(toCall, seat.stack);
						seat.stack -= pay;
						seat.contributed += pay;
						pot += pay;
					} else {
						seat.folded = true;
					}
				}
			}
			updateHUD();
			if(anyChange && tick < 20){
				setTimeout(step, 160);
			} else {
				if(typeof onComplete === 'function') onComplete();
			}
		}
		setTimeout(step, 80);
	}

	function allActivePlayersMatched(){
		for(const s of seats){
			if(s.folded) continue;
			const needed = currentBet - (s.contributed||0);
			if(needed > 0 && s.stack > 0) return false;
		}
		return true;
	}

	function proceedToNextStreet(enableButton){
		if(!allActivePlayersMatched()){
			$('#message').textContent = 'Waiting for everyone to match the bet.';
			return false;
		}
		enablePlayerActions(false);
		for(const s of seats) s.contributed = 0;
		currentBet = 0;
		updateHUD();
		enableButton.disabled = false;
		return true;
	}

	// Improved animateDeal: target card position inside a container is computed so cards don't stack
	function animateDeal(card, targetEl, faceUp = true){
		return new Promise((resolve) => {
			const deckEl = document.getElementById('deck');
			const rootStyle = getComputedStyle(document.documentElement);
			const cw = parseFloat(rootStyle.getPropertyValue('--card-width')) || 92;
			const ch = parseFloat(rootStyle.getPropertyValue('--card-height')) || 128;
			const gap = 10; // matches .hand gap in CSS

			// fallback immediate insertion if no deck element
			if(!deckEl){
				// if target is a hand, append; otherwise replace
				if(targetEl.classList.contains('hand')){
					targetEl.appendChild(faceUp ? renderCardEl(card) : createBack());
				} else {
					targetEl.innerHTML = '';
					targetEl.appendChild(faceUp ? renderCardEl(card) : createBack());
				}
				const child = targetEl.lastElementChild;
				if(child){ child.classList.add('deal-anim'); setTimeout(()=>child.classList.remove('deal-anim'),420); }
				resolve();
				return;
			}

			const deckRect = deckEl.getBoundingClientRect();
			const targetRect = targetEl.getBoundingClientRect();

			// compute where in the target container this card should land
			// for hands we want to offset based on existing cards, for single-slot elements index will be 0
			const currentCount = targetEl.childElementCount || 0;
			const expectedCount = currentCount + 1;
			const index = currentCount;
			const baseCenterX = targetRect.left + targetRect.width / 2;
			const offsetX = (index - (expectedCount - 1) / 2) * (cw + gap);

			// start position (centered on deck)
			const startLeft = deckRect.left + (deckRect.width - cw) / 2;
			const startTop = deckRect.top + (deckRect.height - ch) / 2;

			// target center position adjusted by offset
			const targetCenterX = baseCenterX + offsetX;
			const targetCenterY = targetRect.top + targetRect.height / 2;

			// create flyer element and size it to CSS vars for consistent transforms
			const flyer = faceUp ? renderCardEl(card) : createBack();
			flyer.classList.add('flying-card');
			flyer.style.width = `${cw}px`;
			flyer.style.height = `${ch}px`;
			flyer.style.left = `${startLeft}px`;
			flyer.style.top = `${startTop}px`;
			flyer.style.transform = 'translate(0px,0px) rotate(0deg) scale(1)';
			document.body.appendChild(flyer);

			// force layout
			flyer.getBoundingClientRect();

			// compute dx/dy relative to current flyer position
			const flyerRect = flyer.getBoundingClientRect();
			const dx = targetCenterX - (flyerRect.left + flyerRect.width / 2);
			const dy = targetCenterY - (flyerRect.top + flyerRect.height / 2);

			// slight random rotation for organic feel
			const rot = (Math.random() * 14 - 7).toFixed(2);

			requestAnimationFrame(() => {
				flyer.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(1)`;
				flyer.classList.add('rotate');
			});

			function onEnd(e){
				if(e && e.target !== flyer) return;
				flyer.removeEventListener('transitionend', onEnd);
				// insert actual card into target container (append for hands, replace for slots)
				if(targetEl.classList.contains('hand')){
					const finalEl = faceUp ? renderCardEl(card) : createBack();
					targetEl.appendChild(finalEl);
					finalEl.classList.add('deal-anim');
					setTimeout(()=> finalEl.classList.remove('deal-anim'),420);
				} else {
					targetEl.innerHTML = '';
					const finalEl = faceUp ? renderCardEl(card) : createBack();
					targetEl.appendChild(finalEl);
					finalEl.classList.add('deal-anim');
					setTimeout(()=> finalEl.classList.remove('deal-anim'),420);
				}
				// remove flyer cleanly
				flyer.classList.add('hide');
				setTimeout(()=> { try{ flyer.remove(); }catch(e){} }, 180);
				resolve();
			}

			flyer.addEventListener('transitionend', onEnd);
			// safety timeout in case transitionend doesn't fire
			setTimeout(() => { if(document.body.contains(flyer)) onEnd(); }, 900);
		});
	}

	// place community card using animation (faceUp)
	function placeCardToSlot(card, slot){
		return animateDeal(card, slot, true).catch(()=> {
			slot.innerHTML = '';
			slot.appendChild(renderCardEl(card));
		});
	}

	// single async dealInitial that animates hole cards
	async function dealInitial(){
		if(!ended) return;
		ended = false;
		clearTable();
		buildDeck(); shuffle();
		for(const s of seats){ s.hand = [draw(), draw()]; if(s.stack===undefined) s.stack = 1000; }
		pot = 30; seats.forEach(s => s.stack -= 10);
		resetBettingRound();
		updateHUD();

		const handEls = [
			document.querySelector('#seat-1 .hand'),
			document.querySelector('#seat-2 .hand'),
			document.querySelector('#player-hand')
		];
		handEls.forEach(el => { if(el) el.innerHTML = ''; });

		for(let cardIdx = 0; cardIdx < 2; cardIdx++){
			if(handEls[0]) await animateDeal(seats[0].hand[cardIdx], handEls[0], false);
			await new Promise(r=>setTimeout(r, 120));
			if(handEls[1]) await animateDeal(seats[1].hand[cardIdx], handEls[1], false);
			await new Promise(r=>setTimeout(r, 120));
			if(handEls[2]) await animateDeal(seats[2].hand[cardIdx], handEls[2], true);
			await new Promise(r=>setTimeout(r, 220));
		}

		$('#message').textContent = 'Dealt. CPUs may act briefly.';
		$('#deal-flop').disabled = true; $('#deal-turn').disabled = true; $('#deal-river').disabled = true; $('#showdown').disabled = true;
		startNewHandDisabled(true);
		// previously disabled actions here; keep HUD updated but allow betting anytime
		updateHUD();

		resolveAIActionsAsync(() => {
			// after CPUs reacted, leave actions available so player may bet anytime
			if(!ended && !seats[2].folded) enablePlayerActions();
			updateHUD();
		});
	}

	// community dealing uses placeCardToSlot (animated)
	async function dealFlop(){
		if(!proceedToNextStreet($('#deal-flop'))) return;
		// disable the flop button immediately so it can't be re-pressed this hand
		$('#deal-flop').disabled = true;

		// burn + three
		draw();
		community.push(draw(), draw(), draw());
		for(let i=0;i<3;i++){
			await placeCardToSlot(community[i], $$('.card-slot')[i]);
			await new Promise(r=>setTimeout(r, 120));
		}
		$('#message').textContent = 'Flop dealt. New betting round.';
		updateHUD();
		resolveAIActionsAsync(() => {
			updateHUD();
			if(!ended && !seats[2].folded){
				enablePlayerActions();
				if(allActivePlayersMatched()) $('#deal-turn').disabled = false;
			}
		});
	}

	async function dealTurn(){
		if(!proceedToNextStreet($('#deal-turn'))) return;
		// disable the turn button immediately so it can't be re-pressed this hand
		$('#deal-turn').disabled = true;

		draw();
		community.push(draw());
		await placeCardToSlot(community[3], $$('.card-slot')[3]);
		$('#message').textContent = 'Turn dealt. Betting round.';
		updateHUD();
		resolveAIActionsAsync(() => {
			updateHUD();
			if(!ended && !seats[2].folded){
				enablePlayerActions();
				if(allActivePlayersMatched()) $('#deal-river').disabled = false;
			}
		});
	}

	async function dealRiver(){
		if(!proceedToNextStreet($('#deal-river'))) return;
		// disable the river button immediately so it can't be re-pressed this hand
		$('#deal-river').disabled = true;

		draw();
		community.push(draw());
		await placeCardToSlot(community[4], $$('.card-slot')[4]);
		$('#message').textContent = 'River dealt. Final betting round.';
		updateHUD();
		resolveAIActionsAsync(() => {
			updateHUD();
			if(!ended && !seats[2].folded){
				enablePlayerActions();
				if(allActivePlayersMatched()) $('#showdown').disabled = false;
			}
		});
	}

	// Hand evaluation (best 5 of 7)
	function compareScore(a,b){ for(let i=0;i<Math.max(a.length,b.length);i++){ const ai=a[i]||0, bi=b[i]||0; if(ai>bi) return 1; if(ai<bi) return -1; } return 0; }
	function evaluateBest(cards){
		function combos(arr,k){ let res=[]; function go(start,cur){ if(cur.length===k){ res.push(cur.slice()); return; } for(let i=start;i<arr.length;i++){ cur.push(arr[i]); go(i+1,cur); cur.pop(); } } go(0,[]); return res; }
		function score5(c5){
			const vals = c5.map(c=>c.value).sort((a,b)=>b-a);
			const suits = {}; const counts = {};
			for(const c of c5){ suits[c.suit]=(suits[c.suit]||0)+1; counts[c.value]=(counts[c.value]||0)+1; }
			const isFlush = Object.values(suits).some(v=>v>=5);
			const uniq = Array.from(new Set(c5.map(c=>c.value))).sort((a,b)=>b-a);
			let straightHigh = null;
			for(let i=0;i<uniq.length;i++){
				let cnt=1;
				for(let j=i+1;j<uniq.length;j++){ if(uniq[j]===uniq[j-1]-1) cnt++; else break; }
				if(cnt>=5){ straightHigh = uniq[i-cnt+1] || uniq[i]; break; }
			}
			if(!straightHigh && uniq.includes(14) && uniq.includes(5) && uniq.includes(4) && uniq.includes(3) && uniq.includes(2)) straightHigh = 5;
			if(isFlush){
				for(const s of Object.keys(suits)){
					if(suits[s]>=5){
						const suited = c5.filter(c=>c.suit===s).map(c=>c.value).sort((a,b)=>b-a);
						const u = Array.from(new Set(suited));
						for(let i=0;i<u.length;i++){
							let ok=true; let high=u[i];
							for(let k=1;k<5;k++){ if(!u.includes(high-k)){ ok=false; break; } }
							if(ok) return [8, high];
						}
						if(u.includes(14)&&u.includes(5)&&u.includes(4)&&u.includes(3)&&u.includes(2)) return [8,5];
					}
				}
			}
			const groups = Object.entries(counts).map(([v,c])=>({v:parseInt(v),c})).sort((a,b)=> b.c - a.c || b.v - a.v);
			if(groups[0].c===4){ const quad = groups[0].v; const kicker = Math.max(...vals.filter(v=>v!==quad)); return [7,quad,kicker]; }
			if(groups[0].c===3 && groups[1] && groups[1].c>=2){ return [6,groups[0].v,groups[1].v]; }
			if(isFlush){ const flushSuit = Object.keys(suits).find(s=>suits[s]>=5); const flushVals = c5.filter(c=>c.suit===flushSuit).map(c=>c.value).sort((a,b)=>b-a).slice(0,5); return [5,...flushVals]; }
			if(straightHigh) return [4, straightHigh];
			if(groups[0].c===3){ const trips = groups[0].v; const kickers = vals.filter(v=>v!==trips).slice(0,2); return [3,trips,...kickers]; }
			if(groups[0].c===2 && groups[1] && groups[1].c===2){ const highPair = Math.max(groups[0].v, groups[1].v); const lowPair = Math.min(groups[0].v, groups[1].v); const kicker = vals.filter(v=>v!==highPair && v!==lowPair)[0]; return [2,highPair,lowPair,kicker]; }
			if(groups[0].c===2){ const pair = groups[0].v; const kickers = vals.filter(v=>v!==pair).slice(0,3); return [1,pair,...kickers]; }
			return [0,...vals.slice(0,5)];
		}
		const all = combos(cards,5);
		let best = null;
		for(const c5 of all){ const sc = score5(c5); if(!best || compareScore(sc,best) > 0) best = sc; }
		return best;
	}
	function evaluateBestWithCombo(cards){
		function combos(arr,k){ let res=[]; function go(start,cur){ if(cur.length===k){ res.push(cur.slice()); return; } for(let i=start;i<arr.length;i++){ cur.push(arr[i]); go(i+1,cur); cur.pop(); } } go(0,[]); return res; }
		function score5AndReturnCombo(c5){
			const vals = c5.map(c=>c.value).sort((a,b)=>b-a);
			const suits = {}; const counts = {};
			for(const c of c5){ suits[c.suit]=(suits[c.suit]||0)+1; counts[c.value]=(counts[c.value]||0)+1; }
			const isFlush = Object.values(suits).some(v=>v>=5);
			const uniq = Array.from(new Set(c5.map(c=>c.value))).sort((a,b)=>b-a);
			let straightHigh = null;
			for(let i=0;i<uniq.length;i++){
				let cnt=1;
				for(let j=i+1;j<uniq.length;j++){ if(uniq[j]===uniq[j-1]-1) cnt++; else break; }
				if(cnt>=5){ straightHigh = uniq[i-cnt+1] || uniq[i]; break; }
			}
			if(!straightHigh && uniq.includes(14) && uniq.includes(5) && uniq.includes(4) && uniq.includes(3) && uniq.includes(2)) straightHigh = 5;
			if(isFlush){
				for(const s of Object.keys(suits)){
					if(suits[s]>=5){
						const suited = c5.filter(c=>c.suit===s).map(c=>c.value).sort((a,b)=>b-a);
						const u = Array.from(new Set(suited));
						for(let i=0;i<u.length;i++){
							let ok=true; let high=u[i];
							for(let k=1;k<5;k++){ if(!u.includes(high-k)){ ok=false; break; } }
							if(ok) return [8, high];
						}
						if(u.includes(14)&&u.includes(5)&&u.includes(4)&&u.includes(3)&&u.includes(2)) return [8,5];
					}
				}
			}
			const groups = Object.entries(counts).map(([v,c])=>({v:parseInt(v),c})).sort((a,b)=> b.c - a.c || b.v - a.v);
			if(groups[0].c===4){ const quad = groups[0].v; const kicker = Math.max(...vals.filter(v=>v!==quad)); return [7,quad,kicker]; }
			if(groups[0].c===3 && groups[1] && groups[1].c>=2){ return [6,groups[0].v,groups[1].v]; }
			if(isFlush){ const flushSuit = Object.keys(suits).find(s=>suits[s]>=5); const flushVals = c5.filter(c=>c.suit===flushSuit).map(c=>c.value).sort((a,b)=>b-a).slice(0,5); return [5,...flushVals]; }
			if(straightHigh) return [4, straightHigh];
			if(groups[0].c===3){ const trips = groups[0].v; const kickers = vals.filter(v=>v!==trips).slice(0,2); return [3,trips,...kickers]; }
			if(groups[0].c===2 && groups[1] && groups[1].c===2){ const highPair = Math.max(groups[0].v, groups[1].v); const lowPair = Math.min(groups[0].v, groups[1].v); const kicker = vals.filter(v=>v!==highPair && v!==lowPair)[0]; return [2,highPair,lowPair,kicker]; }
			if(groups[0].c===2){ const pair = groups[0].v; const kickers = vals.filter(v=>v!==pair).slice(0,3); return [1,pair,...kickers]; }
			return [0,...vals.slice(0,5)];
		}
		const all = combos(cards,5);
		let bestScore = null, bestCombo = null;
		for(const c5 of all){
			const sc = score5AndReturnCombo(c5);
			if(!bestScore || compareScore(sc,bestScore) > 0){ bestScore = sc; bestCombo = c5.slice(); }
		}
		return { score: bestScore, combo: bestCombo };
	}

	// AI hand strength evaluation
	function getHandStrength(seatIdx) {
		const seat = seats[seatIdx];
		const hand = seat.hand.concat(community);
		if (community.length === 0) {
			// Pre-flop strength based on hole cards
			const c1 = seat.hand[0], c2 = seat.hand[1];
			const v1 = c1.value, v2 = c2.value;
			const suited = c1.suit === c2.suit;
			const gap = Math.abs(v1 - v2);
			let strength = 0;
			if (v1 === v2) { // pair
				strength = 0.7 + (v1 - 2) / 12 * 0.3; // higher pair better
			} else if (suited) {
				strength = 0.5 + Math.max(v1, v2) / 14 * 0.2 + (gap === 1 ? 0.1 : gap === 2 ? 0.05 : 0);
			} else {
				strength = 0.3 + Math.max(v1, v2) / 14 * 0.2;
			}
			return Math.min(strength, 0.9); // cap at 0.9 for pre-flop
		} else {
			// Post-flop: use evaluateBest score
			const score = evaluateBest(hand);
			const rank = score[0];
			// Normalize rank to strength: 0 (high card) -> 0.1, 8 (straight flush) -> 1.0
			let strength = 0.1 + rank / 8 * 0.9;
			// Adjust based on high cards
			if (rank === 0) strength += score[1] / 14 * 0.05; // high card kicker
			return strength;
		}
	}

	// Win message helper
	function formatWinMessage(name, amount, score){
		const handName = getHandName(score);
		if(name === 'You') return `You win ${amount} chips with ${handName}!`;
		return `${name} wins ${amount} chips with ${handName}!`;
	}

	function getHandName(score){
		const rank = score[0];
		const names = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
		return names[rank] || 'Unknown';
	}

	// Showdown and finishing
	function finishHand(delayMs = 1000){
		// if a delay is requested, schedule a single timer and return
		if(delayMs && delayMs > 0){
			if(window.__finishHandTimer) clearTimeout(window.__finishHandTimer);
			window.__finishHandTimer = setTimeout(()=> finishHand(0), delayMs);
			return;
		}
		// clear any pending timer
		if(window.__finishHandTimer){ clearTimeout(window.__finishHandTimer); window.__finishHandTimer = null; }

		// disable action buttons and allow New Hand immediately
		$('#check-call').disabled = true; $('#raise-btn').disabled = true; $('#allin-btn').disabled = true;
		$('#deal-flop').disabled = true; $('#deal-turn').disabled = true; $('#deal-river').disabled = true; $('#showdown').disabled = true;
		ended = true;
		startNewHandDisabled(false);
		// fold button controlled elsewhere / by enablePlayerActions
		$('#fold-btn').disabled = true;
	}

	function showdown(delayMs = 0){
		// reveal opponent hands
		$$('.seat .hand').forEach((handEl, idx) => {
			handEl.innerHTML = '';
			for(const c of seats[idx].hand) handEl.appendChild(renderCardEl(c));
		});
		// evaluate active
		const active = seats.map((s,i)=>({s,i})).filter(x=>!x.s.folded);
		if(active.length === 0){
			$('#message').textContent = 'Everyone folded? Reseting.';
			finishHand();
			return;
		}
		const results = active.map(({s,i}) => ({name:s.name, score:evaluateBest(s.hand.concat(community)), seat:s, idx:i}));
		// Debug: log scores
		console.log('Showdown results:');
		results.forEach(r => console.log(`${r.name}: ${r.score}`));
		results.sort((a,b)=> compareScore(b.score,a.score));
		const best = results[0];
		const winners = results.filter(r => compareScore(r.score,best.score)===0);
		// highlight winners
		$$('.seat').forEach(el=>el.classList.remove('winner'));
		$('#player-hand').classList.remove('winner');
		for(const w of winners){
			if(w.idx===2) $('#player-hand').classList.add('winner');
			else {
				const seatEl = document.getElementById('seat-'+(w.idx+1));
				if(seatEl) seatEl.classList.add('winner');
			}
		}
		const award = Math.floor(pot / winners.length);
		for(const w of winners) w.seat.stack += award;
		pot = 0;
		updateHUD();
		if(winners.length > 1){
			$('#message').textContent = `Tie: ${winners.map(w=>w.name).join(', ')} — each wins ${award}.`;
		} else {
			$('#message').textContent = formatWinMessage(best.name, award, best.score);
		}
		$('#showdown').disabled = true;

		// NEW: reset CPUs with 0 stack to new name and 1000 chips
		for(let i=0; i<2; i++){
			if(seats[i].stack <= 0){
				const pool = AI_NAMES.slice();
				const used = seats.map(s=>s.name);
				let newName;
				do {
					newName = pool.splice(Math.floor(Math.random()*pool.length),1)[0];
				} while(used.includes(newName));
				seats[i].name = newName;
				seats[i].stack = 1000;
				// update DOM
				const seatEl = document.getElementById('seat-'+(i+1));
				if(seatEl){
					seatEl.querySelector('.name').textContent = newName;
					seatEl.querySelector('.stack-amt').textContent = 1000;
				}
			}
		}

		// NEW: check if player lost all chips (not from all-in)
		if(seats[2].stack <= 0){
			showLoseModal();
			return; // don't finish hand yet, wait for reset
		}

		finishHand(delayMs);
	}

	// Player actions
	function playerCheckCall(){
		if(ended) return;
		const toCall = Math.max(0, currentBet - (seats[2].contributed||0));
		if(toCall === 0){
			$('#message').textContent = 'You check.';
		} else {
			const pay = Math.min(toCall, seats[2].stack);
			seats[2].stack -= pay; seats[2].contributed = (seats[2].contributed||0) + pay; pot += pay;
			$('#message').textContent = `You call ${pay}.`;
		}
		// allow player to keep betting anytime; update HUD and let CPUs react
		updateHUD();
		resolveAIActionsAsync(() => {
			updateHUD();
			if(allActivePlayersMatched()){
				const revealed = community.length;
				if(revealed===0) $('#deal-flop').disabled = false;
				else if(revealed===3) $('#deal-turn').disabled = false;
				else if(revealed===4) $('#deal-river').disabled = false;
				else if(revealed===5) $('#showdown').disabled = false;
			}
		});
	}

	function playerRaise(){
		if(ended) return;
		if((seats[2].raiseCount||0) >= 2){
			$('#message').textContent = 'You cannot raise anymore this betting round.';
			return;
		}
		const raiseVal = Math.max(1, parseInt($('#raise-amt').value || 0));
		const playerContrib = seats[2].contributed||0;
		const toCall = Math.max(0, currentBet - playerContrib);
		const totalPut = toCall + raiseVal;
		const available = seats[2].stack;
		const put = Math.min(available, totalPut);
		seats[2].stack -= put;
		seats[2].contributed = playerContrib + put;
		pot += put;
		const wasCurrentBet = currentBet;
		if(seats[2].contributed > wasCurrentBet){
			currentBet = Math.max(currentBet, seats[2].contributed);
			seats[2].raiseCount = (seats[2].raiseCount||0) + 1;
		}
		$('#message').textContent = `You raised by ${raiseVal} (put ${put}).`;
		updateHUD();
		resolveAIActionsAsync(() => {
			updateHUD();
			if(allActivePlayersMatched()){
				const revealed = community.length;
				if(revealed===0) $('#deal-flop').disabled = false;
				else if(revealed===3) $('#deal-turn').disabled = false;
				else if(revealed===4) $('#deal-river').disabled = false;
				else if(revealed===5) $('#showdown').disabled = false;
			}
		});
	}

	function playerAllIn(){
		if(ended) return;
		const playerContrib = seats[2].contributed || 0;
		const wouldPut = seats[2].stack;
		if((seats[2].raiseCount||0) >= 2 && (playerContrib + wouldPut) > currentBet){
			$('#message').textContent = 'You cannot raise anymore this betting round (all-in would be a raise).';
			return;
		}
		const player = seats[2];
		if(player.stack <= 0) return;
		const prevCurrentBet = currentBet;
		const put = player.stack;
		player.stack = 0;
		player.contributed = playerContrib + put;
		pot += put;
		if(player.contributed > prevCurrentBet){
			currentBet = player.contributed;
			player.raiseCount = (player.raiseCount||0) + 1;
		}
		$('#message').textContent = `You are all-in for ${player.contributed} chips.`;
		updateHUD();
		resolveAIActionsAsync(() => {
			updateHUD();
			if(allActivePlayersMatched()){
				const revealed = community.length;
				if(revealed===0) $('#deal-flop').disabled = false;
				else if(revealed===3) $('#deal-turn').disabled = false;
				else if(revealed===4) $('#deal-river').disabled = false;
				else if(revealed===5) $('#showdown').disabled = false;
			}
		});
	}

	function playerFold(){
		if(ended) return;
		seats[2].folded = true;
		$('#message').textContent = 'You fold.';
		// reveal other hands and award if only one remains
		const active = seats.map((s,i)=>({s,i})).filter(x=>!x.s.folded);
		if(active.length === 1){
			active[0].s.stack += pot;
			$('#message').textContent = `${active[0].s.name} wins ${pot} chips (others folded).`;
			pot = 0;
			updateHUD();
			$$('.seat .hand').forEach((handEl, idx) => { handEl.innerHTML = ''; for(const c of seats[idx].hand) handEl.appendChild(renderCardEl(c)); });
			finishHand();
			return;
		}
		$$('.seat .hand').forEach((handEl, idx) => { handEl.innerHTML = ''; for(const c of seats[idx].hand) handEl.appendChild(renderCardEl(c)); });
		showdown();
	}

	// Hand rankings modal (shows canonical rankings)
	const HAND_RANKINGS = [
		{ name: 'Royal Flush', desc: 'A K Q J 10 — same suit (highest straight flush).', example:[{rank:'A',suit:'♠'},{rank:'K',suit:'♠'},{rank:'Q',suit:'♠'},{rank:'J',suit:'♠'},{rank:'10',suit:'♠'}] },
		{ name: 'Straight Flush', desc: 'Five consecutive cards, same suit.', example:[{rank:'9',suit:'♥'},{rank:'8',suit:'♥'},{rank:'7',suit:'♥'},{rank:'6',suit:'♥'},{rank:'5',suit:'♥'}] },
		{ name: 'Four of a Kind', desc: 'Four cards of same rank + kicker.', example:[{rank:'Q',suit:'♣'},{rank:'Q',suit:'♦'},{rank:'Q',suit:'♠'},{rank:'Q',suit:'♥'},{rank:'9',suit:'♠'}] },
		{ name: 'Full House', desc: 'Three of a kind + a pair.', example:[{rank:'J',suit:'♣'},{rank:'J',suit:'♦'},{rank:'J',suit:'♠'},{rank:'8',suit:'♥'},{rank:'8',suit:'♣'}] },
		{ name: 'Flush', desc: 'Any five cards same suit (not sequential).', example:[{rank:'A',suit:'♦'},{rank:'J',suit:'♦'},{rank:'9',suit:'♦'},{rank:'6',suit:'♦'},{rank:'3',suit:'♦'}] },
		{ name: 'Straight', desc: 'Five consecutive ranks, mixed suits.', example:[{rank:'10',suit:'♣'},{rank:'9',suit:'♠'},{rank:'8',suit:'♦'},{rank:'7',suit:'♣'},{rank:'6',suit:'♥'}] },
		{ name: 'Three of a Kind', desc: 'Three cards of same rank + two kickers.', example:[{rank:'7',suit:'♠'},{rank:'7',suit:'♣'},{rank:'7',suit:'♦'},{rank:'K',suit:'♥'},{rank:'2',suit:'♣'}] },
		{ name: 'Two Pair', desc: 'Two different pairs + kicker.', example:[{rank:'K',suit:'♠'},{rank:'K',suit:'♦'},{rank:'4',suit:'♥'},{rank:'4',suit:'♣'},{rank:'9',suit:'♦'}] },
		{ name: 'One Pair', desc: 'One pair + three kickers.', example:[{rank:'A',suit:'♣'},{rank:'A',suit:'♥'},{rank:'Q',suit:'♦'},{rank:'8',suit:'♠'},{rank:'5',suit:'♣'}] },
		{ name: 'High Card', desc: 'No combination — highest card wins.', example:[{rank:'A',suit:'♣'},{rank:'J',suit:'♦'},{rank:'9',suit:'♠'},{rank:'6',suit:'♥'},{rank:'3',suit:'♣'}] }
	];

	function showHandRankings(){
		const modal = document.getElementById('hands-modal');
		const body = document.getElementById('hands-body');
		if(!modal||!body) return;
		const hdr = modal.querySelector('.modal-header h3');
		if(hdr) hdr.textContent = 'Hand Rankings';
		body.innerHTML = '';
		for(let i=0;i<HAND_RANKINGS.length;i++){
			const r = HAND_RANKINGS[i];
			const row = document.createElement('div'); row.className = 'hand-row';
			const info = document.createElement('div'); info.className = 'hand-info';
			const title = document.createElement('div'); title.innerHTML = `<strong>${i+1}. ${r.name}</strong>`;
			const label = document.createElement('div'); label.style.fontSize='12px'; label.style.opacity='0.9'; label.textContent = r.desc;
			info.appendChild(title); info.appendChild(label);
			const cardsWrap = document.createElement('div'); cardsWrap.className = 'hand-cards';
			for(const c of r.example){
				const value = (c.rank === 'A') ? 14 : (c.rank === 'K' ? 13 : (c.rank === 'Q' ? 12 : (c.rank === 'J' ? 11 : parseInt(c.rank))));
				const card = { rank: c.rank, suit: c.suit, value: value || 0 };
				const el = renderCardEl(card);
				if(r.name === 'Royal Flush') el.classList.add('best');
				cardsWrap.appendChild(el);
			}
			row.appendChild(info); row.appendChild(cardsWrap); body.appendChild(row);
		}
		modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false');
	}
	function hideHandModal(){ const modal = document.getElementById('hands-modal'); if(!modal) return; modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); }

	// NEW: How to Play modal helpers
	function showHowToPlayModal(){ 
		const modal = document.getElementById('howtoplay-modal'); 
		if(!modal) return; 
		modal.classList.remove('hidden'); 
		modal.setAttribute('aria-hidden','false'); 
	}
	function hideHowToPlayModal(){ 
		const modal = document.getElementById('howtoplay-modal'); 
		if(!modal) return; 
		modal.classList.add('hidden'); 
		modal.setAttribute('aria-hidden','true'); 
	}

	// NEW: You Lose modal helpers
	function showLoseModal(){ 
		const modal = document.getElementById('lose-modal'); 
		if(!modal) return; 
		modal.classList.remove('hidden'); 
		modal.setAttribute('aria-hidden','false'); 
	}
	function hideLoseModal(){ 
		const modal = document.getElementById('lose-modal'); 
		if(!modal) return; 
		modal.classList.add('hidden'); 
		modal.setAttribute('aria-hidden','true'); 
	}

	// NEW: Reset game function
	function resetGame(){
		// reset all stacks to 1000
		seats.forEach(s => s.stack = 1000);
		// assign new AI names
		assignAINames();
		// reset counters
		seats.forEach(s => { s.raiseCount = 0; s.contributed = 0; s.folded = false; });
		pot = 0; currentBet = 0; ended = true;
		// clear table
		clearTable();
		// update HUD
		updateHUD();
		// hide modal
		hideLoseModal();
		// enable new hand
		startNewHandDisabled(false);
		$('#message').textContent = 'Game reset. Press New Hand to start.';
	}

	// Wire everything up
	document.addEventListener('DOMContentLoaded', ()=>{
		// assign AI names once
		assignAINames();

		// initialize seat stacks and counters
		for(const s of seats){ s.stack = 1000; s.raiseCount = 0; s.contributed = 0; s.folded = false; }
		pot = 0; currentBet = 0; ended = true;
		updateHUD();

		// Button wiring
		$('#new-hand').addEventListener('click', ()=> dealInitial());
		$('#deal-flop').addEventListener('click', ()=> dealFlop());
		$('#deal-turn').addEventListener('click', ()=> dealTurn());
		$('#deal-river').addEventListener('click', ()=> dealRiver());
		$('#showdown').addEventListener('click', ()=> showdown(1000)); // changed from 5000 to 1000 for 1-second cooldown
		$('#check-call').addEventListener('click', ()=> playerCheckCall());
		$('#raise-btn').addEventListener('click', ()=> playerRaise());
		$('#fold-btn').addEventListener('click', ()=> playerFold());
		$('#allin-btn').addEventListener('click', ()=> playerAllIn());

		const showBtn = document.getElementById('show-hands-btn');
		if(showBtn){ showBtn.addEventListener('click', showHandRankings); }

		const closeBtn = document.getElementById('close-hands');
		if(closeBtn){ closeBtn.addEventListener('click', hideHandModal); }
		const backdrop = document.querySelector('#hands-modal .modal-backdrop');
		if(backdrop){ backdrop.addEventListener('click', hideHandModal); }

		// NEW: Wire How to Play modal
		const closeHowToPlayBtn = document.getElementById('close-howtoplay');
		if(closeHowToPlayBtn){ closeHowToPlayBtn.addEventListener('click', hideHowToPlayModal); }
		const howToPlayBackdrop = document.querySelector('#howtoplay-modal .modal-backdrop');
		if(howToPlayBackdrop){ howToPlayBackdrop.addEventListener('click', hideHowToPlayModal); }
		// Show How to Play on load (no need to explicitly call; modal starts visible)

		// NEW: Wire You Lose modal
		const resetGameBtn = document.getElementById('reset-game');
		if(resetGameBtn){ resetGameBtn.addEventListener('click', resetGame); }

		$('#message').textContent = 'Ready. Press New Hand to deal.';
	});
})();